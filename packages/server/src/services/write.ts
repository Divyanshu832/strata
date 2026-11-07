// The write path.
//   With facts (default: your agent extracted them) → store source → resolve → reconcile → embed → save.
//   Raw text only → store source → background job: Strata extractor if enabled, else index the text so it
//   is still searchable. Nothing is ever dropped.
import { and, eq, isNull } from "drizzle-orm";
import { withWorkspace, type Tx } from "../db/client.js";
import { chunks, facts, sources, type NewFact, type Source } from "../db/schema.js";
import { config } from "../config.js";
import { resolveEntity } from "./entities.js";
import { normaliseValue, reconcile } from "./reconcile.js";
import { embed } from "./embed.js";
import { extract, EXTRACTOR_VERSION } from "./extract.js";
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

export type ApplyResult = { added: number; skipped: number; updated: number; contradictions: number };

async function loadSource(workspaceId: string, sourceId: string): Promise<Source> {
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
  const result: ApplyResult = { added: 0, skipped: 0, updated: 0, contradictions: 0 };
  const source = await loadSource(workspaceId, sourceId);
  const embeddings = await embed(payload.facts.map(statementOf)); // outside the transaction

  return withWorkspace(workspaceId, async (tx) => {
    const ids = new Map<string, string>();
    const idFor = async (name: string, type?: string, aliases?: string[]) => {
      const key = name.toLowerCase();
      if (!ids.has(key)) ids.set(key, (await resolveEntity(tx, workspaceId, { name, type, aliases })).id);
      return ids.get(key)!;
    };
    for (const e of payload.entities) await idFor(e.name, e.type, e.aliases);

    for (const [i, f] of payload.facts.entries()) {
      const subjectId = await idFor(f.subject, f.subject === "user" ? "person" : undefined);
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
      const [created] = await tx.insert(facts).values(row).returning({ id: facts.id });

      if (decision.action === "update") {
        // Never delete: close the old facts and point them at their replacement.
        for (const oldId of decision.replaces) {
          await tx
            .update(facts)
            .set({ validTo: validFrom, status: "replaced", supersededBy: created!.id })
            .where(eq(facts.id, oldId));
        }
        result.updated++;
      } else if (decision.action === "contradiction") {
        result.contradictions++;
      } else {
        result.added++;
      }
    }

    await tx.update(sources).set({ extractedAt: new Date() }).where(eq(sources.id, sourceId));
    return result;
  });
}

/** Background job for raw-text sources. */
export async function processRawSource(workspaceId: string, sourceId: string): Promise<ApplyResult | { chunks: number }> {
  if (config.EXTRACTOR === "openrouter") {
    const source = await loadSource(workspaceId, sourceId);
    const payload = await extract({ content: source.content, author: source.author, occurredAt: source.occurredAt });
    return applyFacts(workspaceId, sourceId, payload, EXTRACTOR_VERSION);
  }
  return { chunks: await indexChunks(workspaceId, sourceId) };
}

/** No extractor: split the raw text into chunks and embed them, so it can still be found. */
export async function indexChunks(workspaceId: string, sourceId: string): Promise<number> {
  const source = await loadSource(workspaceId, sourceId);
  const parts = splitText(source.content);
  const vectors = await embed(parts);
  await withWorkspace(workspaceId, async (tx) => {
    await tx.delete(chunks).where(eq(chunks.sourceId, sourceId));
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
  const keyOf = (o: { objectId: string | null; objectValue: string | null }) => o.objectId ?? normaliseValue(o.objectValue ?? "");
  return reconcile(
    current.map((c) => ({ id: c.id, objectKey: keyOf(c), validFrom: c.validFrom })),
    { objectKey: keyOf({ objectId, objectValue: objectId ? null : f.object }), exclusive: f.exclusive, validFrom },
  );
}
