// The write path.
//   With facts (default: your agent extracted them) → store source → resolve → reconcile → embed → save.
//   Raw text only → store source → background job: Strata extractor if enabled, else index the text so it
//   is still searchable. Nothing is ever dropped.
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { withWorkspace, type Tx, uuids } from "../db/client.js";
import { chunks, facts, sources, type NewFact, type Source } from "../db/schema.js";
import { config } from "../config.js";
import { canonicalName, resolveEntity } from "./entities.js";
import { normaliseValue, reconcile } from "./reconcile.js";
import { embed } from "./embed.js";
import { extract, EXTRACTOR_VERSION } from "./extract.js";
import { publish } from "./events.js";
import { logUsage } from "./usage.js";
import { statementOf, type AgentFact, type MemoryPayload } from "./memory-input.js";

export type IngestInput = {
  content?: string;
  kind?: "message" | "session" | "document";
  scope?: string;
  author?: string;
  externalId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

/** Store the source as-is. Idempotent on (workspace, externalId). */
export async function storeSource(
  workspaceId: string,
  input: IngestInput & { content: string },
): Promise<{ id: string; duplicate: boolean }> {
  return withWorkspace(workspaceId, async (tx) => {
    const inserted = await tx
      .insert(sources)
      .values({
        workspaceId,
        kind: input.kind ?? "message",
        scope: input.scope ?? "user",
        author: input.author,
        externalId: input.externalId,
        content: input.content,
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      })
      .onConflictDoNothing({ target: [sources.workspaceId, sources.externalId] })
      .returning({ id: sources.id });
    if (inserted[0]) return { id: inserted[0].id, duplicate: false };

    const [existing] = await tx
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.workspaceId, workspaceId), eq(sources.externalId, input.externalId!)));
    return { id: existing!.id, duplicate: true };
  });
}

export type ApplyResult = { added: number; skipped: number; updated: number; history: number; contradictions: number };

export async function loadSource(workspaceId: string, sourceId: string): Promise<Source> {
  const source = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.select().from(sources).where(eq(sources.id, sourceId));
    return row;
  });
  if (!source) throw new Error(`source ${sourceId} not found`);
  return source;
}

/**
 * Save structured facts (from an agent or the Strata extractor) against a source.
 * No LLM here: entity matching, replacing old facts and flagging conflicts are plain code + SQL.
 */
export async function applyFacts(
  workspaceId: string,
  sourceId: string,
  payload: MemoryPayload,
  extractorVersion = "agent",
): Promise<ApplyResult> {
  const started = performance.now();
  const result: ApplyResult = { added: 0, skipped: 0, updated: 0, history: 0, contradictions: 0 };
  const source = await loadSource(workspaceId, sourceId);
  const embeddings = await embed(payload.facts.map(statementOf)); // outside the transaction
  const touched = new Set<string>();

  await withWorkspace(workspaceId, async (tx) => {
    const ids = new Map<string, string>();
    const idFor = async (name: string, type?: string, aliases?: string[]) => {
      const key = canonicalName(name).toLowerCase();
      if (!ids.has(key)) ids.set(key, (await resolveEntity(tx, workspaceId, { name, type, aliases })).id);
      return ids.get(key)!;
    };
    for (const e of payload.entities) await idFor(e.name, e.type, e.aliases);

    for (const [i, f] of payload.facts.entries()) {
      const subjectId = await idFor(f.subject, canonicalName(f.subject) === "user" ? "person" : undefined);
      const objectId = f.objectType === "entity" ? await idFor(f.object) : null;
      const validFrom = f.validFrom ? new Date(f.validFrom) : source.occurredAt;
      const decision = await reconcileOne(tx, workspaceId, subjectId, f, objectId, validFrom);

      if (decision.action === "skip") {
        result.skipped++;
        continue;
      }
      const row: NewFact = {
        workspaceId,
        scope: source.scope,
        kind: f.kind,
        subjectId,
        predicate: f.predicate,
        objectId,
        objectValue: objectId ? null : f.object,
        statement: statementOf(f),
        context: f.context,
        strength: f.strength,
        validFrom,
        sourceId,
        extractorVersion,
        status: decision.action === "contradiction" ? "contradiction" : "active",
        embedding: embeddings[i],
      };
      if (decision.action === "history") {
        // Learned late: it was true before the value we hold. Store it already closed.
        Object.assign(row, { validTo: decision.closeAt, status: "replaced", supersededBy: decision.supersededBy });
      }
      const [created] = await tx.insert(facts).values(row).returning({ id: facts.id });
      touched.add(subjectId);
      if (objectId) touched.add(objectId);

      // Never delete: close the old facts and point them at their replacement.
      const replaces = decision.action === "update" || decision.action === "history" ? decision.replaces : [];
      if (replaces.length) {
        await tx
          .update(facts)
          .set({ validTo: validFrom, status: "replaced", supersededBy: created!.id })
          .where(inArray(facts.id, replaces));
      }
      if (decision.action === "update" && replaces.length) result.updated++;
      else if (decision.action === "history") result.history++;
      else if (decision.action === "contradiction") result.contradictions++;
      else result.added++;
    }

    if (touched.size) await tx.execute(sql`update entities set updated_at = now() where id = any(${uuids([...touched])})`);
    await tx.update(sources).set({ extractedAt: new Date() }).where(eq(sources.id, sourceId));
  });

  publish(workspaceId, { type: "facts", sourceId, ...result, entityIds: [...touched] });
  void logUsage(workspaceId, {
    kind: "remember",
    items: result.added + result.updated + result.history + result.contradictions,
    latencyMs: performance.now() - started,
  });
  return result;
}

/** Background job for raw-text sources. */
export async function processRawSource(workspaceId: string, sourceId: string): Promise<ApplyResult | { chunks: number }> {
  // Raw text is always indexed, so it is searchable even if the extractor finds nothing.
  const n = await indexChunks(workspaceId, sourceId);
  if (config.EXTRACTOR !== "openrouter") {
    await withWorkspace(workspaceId, (tx) => tx.update(sources).set({ extractedAt: new Date() }).where(eq(sources.id, sourceId)));
    publish(workspaceId, { type: "chunks", sourceId, chunks: n });
    return { chunks: n };
  }
  return runExtractor(workspaceId, sourceId);
}

async function runExtractor(workspaceId: string, sourceId: string): Promise<ApplyResult> {
  const source = await loadSource(workspaceId, sourceId);
  const started = performance.now();
  const { payload, usage } = await extract({ content: source.content, author: source.author, occurredAt: source.occurredAt });
  void logUsage(workspaceId, {
    kind: "extract",
    items: payload.facts.length,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    latencyMs: performance.now() - started,
  });
  return applyFacts(workspaceId, sourceId, payload, EXTRACTOR_VERSION);
}

/**
 * Re-extract a source with the current extractor. Facts the older extractor made from this source are
 * closed (kept as history, never deleted), then the new facts go through the normal write path.
 * Agent-written facts are never touched.
 */
export async function reextractSource(workspaceId: string, sourceId: string): Promise<ApplyResult> {
  await withWorkspace(workspaceId, (tx) =>
    tx
      .update(facts)
      .set({ validTo: new Date(), status: "replaced" })
      .where(
        and(
          eq(facts.sourceId, sourceId),
          isNull(facts.validTo),
          ne(facts.extractorVersion, "agent"),
          ne(facts.extractorVersion, EXTRACTOR_VERSION),
          eq(facts.pinned, false),
        ),
      ),
  );
  return runExtractor(workspaceId, sourceId);
}

/** No extractor: split the raw text into chunks and embed them, so it can still be found. */
export async function indexChunks(workspaceId: string, sourceId: string): Promise<number> {
  const source = await loadSource(workspaceId, sourceId);
  const parts = splitText(source.content);
  const vectors = await embed(parts);
  await withWorkspace(workspaceId, async (tx) => {
    await tx.delete(chunks).where(eq(chunks.sourceId, sourceId)); // derived data, rebuilt from the source
    if (parts.length) {
      await tx.insert(chunks).values(
        parts.map((content, ordinal) => ({ workspaceId, scope: source.scope, sourceId, ordinal, content, embedding: vectors[ordinal] })),
      );
    }
  });
  return parts.length;
}

/** ~1,000-character chunks on paragraph/sentence boundaries. */
export function splitText(text: string, size = 1000): string[] {
  const pieces = text.split(/(?<=[.!?])\s+|\n{2,}/);
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 1 > size) {
      out.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + piece;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function reconcileOne(tx: Tx, workspaceId: string, subjectId: string, f: AgentFact, objectId: string | null, validFrom: Date) {
  const current = await tx
    .select({ id: facts.id, objectId: facts.objectId, objectValue: facts.objectValue, validFrom: facts.validFrom })
    .from(facts)
    .where(
      and(eq(facts.workspaceId, workspaceId), eq(facts.subjectId, subjectId), eq(facts.predicate, f.predicate), isNull(facts.validTo)),
    );
  // Events repeat ("went to the gym" each week): the same event on another day is a new fact, not a duplicate.
  const day = (d: Date) => (f.kind === "event" ? `@${d.toISOString().slice(0, 10)}` : "");
  const keyOf = (o: { objectId: string | null; objectValue: string | null; validFrom: Date }) =>
    (o.objectId ?? normaliseValue(o.objectValue ?? "")) + day(o.validFrom);
  return reconcile(
    current.map((c) => ({ id: c.id, objectKey: keyOf(c), validFrom: c.validFrom })),
    { objectKey: keyOf({ objectId, objectValue: objectId ? null : f.object, validFrom }), exclusive: f.exclusive, validFrom },
  );
}
