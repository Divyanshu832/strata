// Workspace-level routes: raw sources, processing status, overview stats, usage, live events, maintenance.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withWorkspace } from "../db/client.js";
import { config } from "../config.js";
import type { AuthVars } from "../lib/auth.js";
import { enqueueReextract } from "../jobs/queue.js";
import { subscribe } from "../services/events.js";
import { findDuplicates, findPhraseNotes, fixPhraseNotes, mergeDuplicates, staleSources } from "../services/maintenance.js";
import { usageSummary } from "../services/usage.js";
import { llmEnabled } from "../services/llm.js";
import { rerankEnabled } from "../services/rerank.js";

export const workspace = new Hono<{ Variables: AuthVars }>()
  // Raw sources, newest first. ?q= searches their text.
  .get("/sources", async (c) => {
    const ws = c.get("workspaceId");
    const q = c.req.query("q")?.trim();
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select s.id, s.kind, s.scope, s.author, left(s.content, 400) as content, s.occurred_at as "occurredAt",
               s.extracted_at as "processedAt",
               (select count(*) from facts f where f.source_id = s.id)::int as facts
        from sources s
        where s.workspace_id = ${ws} ${q ? sql`and s.content ilike ${"%" + q + "%"}` : sql``}
        order by s.occurred_at desc limit ${limit}`),
    );
    return c.json({ sources: rows });
  })

  // One source in full, with every fact that came from it.
  .get("/sources/:id", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const data = await withWorkspace(ws, async (tx) => {
      const [source] = await tx.execute(sql`
        select id, kind, scope, author, content, metadata, occurred_at as "occurredAt", created_at as "createdAt",
               extracted_at as "processedAt", external_id as "externalId"
        from sources where id = ${id}`);
      if (!source) return null;
      const facts = await tx.execute(sql`
        select f.id, f.statement, f.status, f.valid_from as "validFrom", f.valid_to as "validTo",
               f.extractor_version as "extractorVersion", f.subject_id as "subjectId"
        from facts f where f.source_id = ${id} order by f.recorded_at`);
      return { source, facts };
    });
    if (!data) throw new HTTPException(404, { message: "not found" });
    return c.json(data);
  })

  // Is background work done? (raw sources waiting to be indexed / extracted)
  .get("/status", async (c) => {
    const ws = c.get("workspaceId");
    const [row] = await withWorkspace(ws, (tx) =>
      tx.execute<{ pending: number }>(sql`select count(*)::int as pending from sources where workspace_id = ${ws} and extracted_at is null`),
    );
    return c.json({
      pendingSources: Number(row?.pending ?? 0),
      extractor: config.EXTRACTOR,
      answer: llmEnabled(),
      reranker: rerankEnabled() ? config.RERANK_MODEL : null,
      embeddingModel: config.EMBEDDING_MODEL,
    });
  })

  // Overview numbers for the home page.
  .get("/stats", async (c) => {
    const ws = c.get("workspaceId");
    const [row] = await withWorkspace(ws, (tx) =>
      tx.execute<Record<string, number>>(sql`
        select
          (select count(*) from entities where workspace_id = ${ws})::int as notes,
          (select count(*) from facts where workspace_id = ${ws} and valid_to is null)::int as current_facts,
          (select count(*) from facts where workspace_id = ${ws} and valid_to is not null)::int as history_facts,
          (select count(*) from facts where workspace_id = ${ws} and object_id is not null and valid_to is null)::int as links,
          (select count(*) from facts where workspace_id = ${ws} and status = 'contradiction')::int as contradictions,
          (select count(*) from sources where workspace_id = ${ws})::int as sources,
          (select count(*) from chunks where workspace_id = ${ws})::int as chunks`),
    );
    const recent = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select f.id, f.statement, f.kind, f.status, f.recorded_at as "recordedAt", f.subject_id as "subjectId", e.name as subject
        from facts f join entities e on e.id = f.subject_id
        where f.workspace_id = ${ws} order by f.recorded_at desc limit 12`),
    );
    const n = (k: string) => Number(row?.[k] ?? 0);
    return c.json({
      notes: n("notes"), currentFacts: n("current_facts"), historyFacts: n("history_facts"), links: n("links"),
      contradictions: n("contradictions"), sources: n("sources"), chunks: n("chunks"), recent,
    });
  })

  .get("/usage", async (c) => {
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
    return c.json(await usageSummary(c.get("workspaceId"), days));
  })

  // Audit log: every edit, merge, review decision and forget.
  .get("/audit", async (c) => {
    const ws = c.get("workspaceId");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select id, actor, action, target_type as "targetType", target_id as "targetId", before, after, at
        from audit_log where workspace_id = ${ws} order by at desc limit 100`),
    );
    return c.json({ audit: rows });
  })

  // Live updates (server-sent events): new facts, chunks, edits.
  .get("/events", (c) => {
    const ws = c.get("workspaceId");
    return streamSSE(c, async (stream) => {
      let open = true;
      const off = subscribe(ws, (e) => void stream.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => {}));
      stream.onAbort(() => {
        open = false;
        off();
      });
      while (open) {
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(25_000);
      }
    });
  })

  // Maintenance. dryRun shows what would change before anything does.
  .post("/maintenance/merge-duplicates", zValidator("json", z.object({ dryRun: z.boolean().default(true) })), async (c) => {
    const ws = c.get("workspaceId");
    const { dryRun } = c.req.valid("json");
    return c.json({ dryRun, pairs: dryRun ? await findDuplicates(ws) : await mergeDuplicates(ws) });
  })
  .post("/maintenance/phrase-notes", zValidator("json", z.object({ dryRun: z.boolean().default(true) })), async (c) => {
    const ws = c.get("workspaceId");
    const { dryRun } = c.req.valid("json");
    return c.json({ dryRun, notes: dryRun ? await findPhraseNotes(ws) : await fixPhraseNotes(ws) });
  })
  .post("/maintenance/reextract", zValidator("json", z.object({ dryRun: z.boolean().default(true) })), async (c) => {
    const ws = c.get("workspaceId");
    const stale = await staleSources(ws);
    if (c.req.valid("json").dryRun) return c.json({ dryRun: true, sources: stale });
    if (config.EXTRACTOR !== "openrouter") throw new HTTPException(501, { message: "re-extraction needs EXTRACTOR=openrouter" });
    for (const s of stale) await enqueueReextract({ workspaceId: ws, sourceId: s.sourceId });
    return c.json({ dryRun: false, queued: stale.length });
  });
