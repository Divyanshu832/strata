import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { withWorkspace } from "../db/client.js";
import { auditLog, facts, sources } from "../db/schema.js";
import type { AuthVars } from "../lib/auth.js";
import { enqueueExtract } from "../jobs/queue.js";
import { applyFacts, storeSource } from "../services/write.js";
import { AgentFact, EntityHint, statementOf } from "../services/memory-input.js";

/**
 * One memory. Send `facts` (your agent already extracted them; saved right away, no LLM), or only
 * `content` (raw text; processed in the background by the Strata extractor if enabled, else indexed).
 */
const Ingest = z
  .object({
    content: z.string().min(1).optional(),
    facts: z.array(AgentFact).max(100).optional(),
    entities: z.array(EntityHint).optional(),
    kind: z.enum(["message", "session", "document"]).optional(),
    scope: z.string().optional(),
    author: z.string().optional(),
    externalId: z.string().optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((m) => m.content || m.facts?.length, { message: "send content, facts, or both" });

const Patch = z.object({
  statement: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
  validTo: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(["active", "contradiction"]).optional(), // resolve a flagged fact
});

export const memories = new Hono<{ Variables: AuthVars }>()
  // Store one or many memories.
  .post("/memories", zValidator("json", z.union([Ingest, z.object({ items: z.array(Ingest).min(1).max(100) })])), async (c) => {
    const ws = c.get("workspaceId");
    const body = c.req.valid("json");
    const items = "items" in body ? body.items : [body];
    const stored = [];
    for (const item of items) {
      // The source is always kept. With only facts, it is the facts written out as sentences.
      const content = item.content ?? (item.facts ?? []).map(statementOf).join("\n");
      const s = await storeSource(ws, { ...item, content });
      if (s.duplicate) {
        stored.push({ ...s, mode: "duplicate" as const });
      } else if (item.facts?.length) {
        const result = await applyFacts(ws, s.id, { facts: item.facts, entities: item.entities ?? [] });
        stored.push({ ...s, mode: "facts" as const, result });
      } else {
        await enqueueExtract({ workspaceId: ws, sourceId: s.id });
        stored.push({ ...s, mode: "queued" as const });
      }
    }
    return c.json({ sources: stored }, 201);
  })

  .get("/memories", async (c) => {
    const ws = c.get("workspaceId");
    const status = c.req.query("status");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const rows = await withWorkspace(ws, (tx) =>
      tx
        .select({
          id: facts.id, statement: facts.statement, kind: facts.kind, predicate: facts.predicate,
          validFrom: facts.validFrom, validTo: facts.validTo, status: facts.status, pinned: facts.pinned,
        })
        .from(facts)
        .where(and(eq(facts.workspaceId, ws), status ? sql`${facts.status} = ${status}` : undefined))
        .orderBy(desc(facts.recordedAt))
        .limit(limit),
    );
    return c.json({ facts: rows });
  })

  // One fact, its source and its version chain (what it replaced / what replaced it).
  .get("/memories/:id", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const data = await withWorkspace(ws, async (tx) => {
      const [fact] = await tx.select().from(facts).where(eq(facts.id, id));
      if (!fact) return null;
      const [source] = fact.sourceId ? await tx.select().from(sources).where(eq(sources.id, fact.sourceId)) : [];
      const versions = await tx
        .select({ id: facts.id, statement: facts.statement, validFrom: facts.validFrom, validTo: facts.validTo, status: facts.status })
        .from(facts)
        .where(and(eq(facts.subjectId, fact.subjectId), eq(facts.predicate, fact.predicate)))
        .orderBy(desc(facts.validFrom));
      const { embedding: _e, ...rest } = fact;
      return { fact: rest, source: source ?? null, versions };
    });
    if (!data) throw new HTTPException(404, { message: "not found" });
    return c.json(data);
  })

  .patch("/memories/:id", zValidator("json", Patch), async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const patch = c.req.valid("json");
    const updated = await withWorkspace(ws, async (tx) => {
      const [before] = await tx.select().from(facts).where(eq(facts.id, id));
      if (!before) return null;
      const [after] = await tx
        .update(facts)
        .set({
          statement: patch.statement,
          pinned: patch.pinned,
          status: patch.status,
          validTo: patch.validTo === undefined ? undefined : patch.validTo ? new Date(patch.validTo) : null,
        })
        .where(eq(facts.id, id))
        .returning();
      await tx.insert(auditLog).values({
        workspaceId: ws, actor: c.get("actor"), action: "edit", targetType: "fact", targetId: id,
        before: { ...before, embedding: undefined }, after: { ...after, embedding: undefined },
      });
      return after;
    });
    if (!updated) throw new HTTPException(404, { message: "not found" });
    const { embedding: _e, ...rest } = updated;
    return c.json({ fact: rest });
  })

  // Forget: the only real delete. Logged first.
  .delete("/memories/:id", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const ok = await withWorkspace(ws, async (tx) => {
      const [before] = await tx.select().from(facts).where(eq(facts.id, id));
      if (!before) return false;
      await tx.insert(auditLog).values({
        workspaceId: ws, actor: c.get("actor"), action: "forget", targetType: "fact", targetId: id,
        before: { ...before, embedding: undefined },
      });
      await tx.update(facts).set({ supersededBy: null }).where(eq(facts.supersededBy, id));
      await tx.delete(facts).where(eq(facts.id, id));
      return true;
    });
    if (!ok) throw new HTTPException(404, { message: "not found" });
    return c.json({ forgotten: id });
  });
