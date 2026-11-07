// The write path: store the raw source, then (in a background job) extract, resolve, reconcile, embed.
import { and, eq, isNull } from "drizzle-orm";
import { withWorkspace, type Tx } from "../db/client.js";
import { facts, sources, type NewFact } from "../db/schema.js";
import { EXTRACTOR_VERSION } from "../config.js";
import { extract, type ExtractedFact } from "./extract.js";
import { resolveEntity } from "./entities.js";
import { normaliseValue, reconcile } from "./reconcile.js";
import { embed } from "./embed.js";

export type IngestInput = {
  content: string;
  kind?: "message" | "session" | "document";
  scope?: string;
  author?: string;
  externalId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

/** Step 1: store the source as-is. Idempotent on (workspace, externalId). */
export async function storeSource(workspaceId: string, input: IngestInput): Promise<{ id: string; duplicate: boolean }> {
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

export type ProcessResult = { added: number; skipped: number; updated: number; contradictions: number };

/** Steps 2-5, run by the `extract-source` job. Safe to re-run: duplicates are skipped. */
export async function processSource(workspaceId: string, sourceId: string): Promise<ProcessResult> {
  const result: ProcessResult = { added: 0, skipped: 0, updated: 0, contradictions: 0 };

  // Model calls happen outside the transaction so a slow LLM call never holds database locks.
  const source = await withWorkspace(workspaceId, async (tx) => {
    const [row] = await tx.select().from(sources).where(eq(sources.id, sourceId));
    return row;
  });
  if (!source) throw new Error(`source ${sourceId} not found`);
  const extraction = await extract({ content: source.content, author: source.author, occurredAt: source.occurredAt });
  const embeddings = await embed(extraction.facts.map((f) => f.statement));

  return withWorkspace(workspaceId, async (tx) => {
    // Resolve every named entity once.
    const ids = new Map<string, string>();
    const idFor = async (name: string, type?: string, aliases?: string[]) => {
      const key = name.toLowerCase();
      if (!ids.has(key)) ids.set(key, (await resolveEntity(tx, workspaceId, { name, type, aliases })).id);
      return ids.get(key)!;
    };
    for (const e of extraction.entities) await idFor(e.name, e.type, e.aliases);

    for (const [i, f] of extraction.facts.entries()) {
      const subjectId = await idFor(f.subject, f.subject === "user" ? "person" : undefined);
      const objectId = f.object_entity ? await idFor(f.object_entity) : null;
      const validFrom = f.valid_from ? new Date(f.valid_from) : source.occurredAt;
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
        objectValue: objectId ? null : f.object_value,
        statement: f.statement,
        context: f.context,
        strength: f.strength,
        validFrom,
        sourceId,
        extractorVersion: EXTRACTOR_VERSION,
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

async function reconcileOne(
  tx: Tx,
  workspaceId: string,
  subjectId: string,
  f: ExtractedFact,
  objectId: string | null,
  validFrom: Date,
) {
  const current = await tx
    .select({ id: facts.id, objectId: facts.objectId, objectValue: facts.objectValue, validFrom: facts.validFrom })
    .from(facts)
    .where(
      and(
        eq(facts.workspaceId, workspaceId),
        eq(facts.subjectId, subjectId),
        eq(facts.predicate, f.predicate),
        isNull(facts.validTo),
      ),
    );
  const keyOf = (o: { objectId: string | null; objectValue: string | null }) =>
    o.objectId ?? normaliseValue(o.objectValue ?? "");
  return reconcile(
    current.map((c) => ({ id: c.id, objectKey: keyOf(c), validFrom: c.validFrom })),
    { objectKey: keyOf({ objectId, objectValue: f.object_value }), exclusive: f.exclusive, validFrom },
  );
}
