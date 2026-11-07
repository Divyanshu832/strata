// Obsidian-like API for the web app and agents: notes, links, backlinks, graph, timeline, review, export.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { withWorkspace } from "../db/client.js";
import type { AuthVars } from "../lib/auth.js";
import { fullGraph, loadNote, neighbours } from "../services/graph.js";
import { formatChain, graphAt, noteFileName, renderNoteMarkdown } from "../services/notes.js";
import { mergeEntities, resolveContradiction, updateEntity } from "../services/edit.js";

const EntityPatch = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(["person", "org", "project", "place", "topic", "thing"]).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  summary: z.string().nullable().optional(),
});

export const notes = new Hono<{ Variables: AuthVars }>()
  // Note list for the sidebar / quick switcher.
  .get("/notes", async (c) => {
    const ws = c.get("workspaceId");
    const q = c.req.query("q")?.trim();
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute<{ id: string; name: string; type: string; tags: string[]; aliases: string[]; facts: number; links: number; updated_at: string }>(sql`
        select e.id, e.name, e.type, e.tags, e.aliases, e.updated_at,
          (select count(*) from facts f where f.subject_id = e.id and f.valid_to is null)::int as facts,
          (select count(*) from facts f where f.object_id = e.id and f.valid_to is null)::int as links
        from entities e
        where e.workspace_id = ${ws}
          ${q ? sql`and (e.name ilike ${"%" + q + "%"} or exists (select 1 from unnest(e.aliases) a where a ilike ${"%" + q + "%"})
                    or similarity(e.name, ${q}) > 0.3)` : sql``}
        order by ${q ? sql`similarity(e.name, ${q}) desc,` : sql``} e.updated_at desc
        limit 500`),
    );
    return c.json({ notes: rows.map(({ updated_at, ...r }) => ({ ...r, updatedAt: new Date(updated_at).toISOString() })) });
  })

  // One note: structured data + Obsidian-compatible markdown.
  .get("/notes/:id", async (c) => {
    const ws = c.get("workspaceId");
    const note = await withWorkspace(ws, (tx) => loadNote(tx, ws, c.req.param("id")));
    if (!note) throw new HTTPException(404, { message: "not found" });
    return c.json({ note, markdown: renderNoteMarkdown(note) });
  })

  // Rename, retype, aliases, tags (audited).
  .patch("/notes/:id", zValidator("json", EntityPatch), async (c) => {
    const updated = await updateEntity(c.get("workspaceId"), c.get("actor"), c.req.param("id"), c.req.valid("json"));
    if (!updated) throw new HTTPException(404, { message: "not found" });
    return c.json({ note: updated });
  })

  // Two notes are the same thing: move every fact and alias into `into` (audited).
  .post("/notes/:id/merge", zValidator("json", z.object({ into: z.uuid() })), async (c) => {
    const id = c.req.param("id");
    const { into } = c.req.valid("json");
    if (id === into) throw new HTTPException(400, { message: "cannot merge a note into itself" });
    const ok = await mergeEntities(c.get("workspaceId"), c.get("actor"), id, into);
    if (!ok) throw new HTTPException(404, { message: "not found" });
    return c.json({ merged: id, into });
  })

  // Server-side link following: the connected chain around a note.
  .get("/notes/:id/neighbours", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const hops = Math.min(Math.max(Number(c.req.query("hops") ?? 2) || 2, 1), 3);
    const graph = await withWorkspace(ws, (tx) => neighbours(tx, ws, [id], hops));
    return c.json({ graph, chain: formatChain(graph, [id]) });
  })

  // Everything that happened to an entity, in time order (as subject or object).
  .get("/entities/:id/timeline", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select f.id, f.statement, f.predicate, f.kind, f.valid_from as "validFrom", f.valid_to as "validTo",
               f.recorded_at as "recordedAt", f.status, f.source_id as "sourceId"
        from facts f
        where f.workspace_id = ${ws} and (f.subject_id = ${id} or f.object_id = ${id})
        order by f.valid_from`),
    );
    return c.json({ timeline: rows });
  })

  // Whole graph; ?at=2026-03-01 gives the graph as it was then (the time slider).
  .get("/graph", async (c) => {
    const ws = c.get("workspaceId");
    const at = c.req.query("at");
    const graph = await withWorkspace(ws, (tx) => fullGraph(tx, ws));
    return c.json(at ? graphAt(graph, new Date(at)) : graph);
  })

  // Contradictions to review, each with the facts it conflicts with.
  .get("/review", async (c) => {
    const ws = c.get("workspaceId");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select f.id, f.statement, f.valid_from as "validFrom", f.recorded_at as "recordedAt", f.subject_id as "subjectId",
               s.name as subject, f.predicate, f.source_id as "sourceId", src.content as "sourceContent",
               coalesce((
                 select json_agg(json_build_object('id', o.id, 'statement', o.statement, 'validFrom', o.valid_from,
                                                   'sourceId', o.source_id, 'status', o.status))
                 from facts o
                 where o.workspace_id = f.workspace_id and o.subject_id = f.subject_id and o.predicate = f.predicate
                   and o.id <> f.id and o.valid_to is null
               ), '[]') as "conflictsWith"
        from facts f
        join entities s on s.id = f.subject_id
        left join sources src on src.id = f.source_id
        where f.workspace_id = ${ws} and f.status = 'contradiction'
        order by f.recorded_at desc`),
    );
    return c.json({ contradictions: rows });
  })

  // accept = the flagged fact wins (others closed); reject = it is closed; keep_both = both stay true.
  .post("/review/:id", zValidator("json", z.object({ action: z.enum(["accept", "reject", "keep_both"]) })), async (c) => {
    const ok = await resolveContradiction(c.get("workspaceId"), c.get("actor"), c.req.param("id"), c.req.valid("json").action);
    if (!ok) throw new HTTPException(404, { message: "not found or not flagged" });
    return c.json({ resolved: c.req.param("id"), action: c.req.valid("json").action });
  })

  // Obsidian vault export: a .zip with one markdown file per note (?format=json for the raw files).
  .get("/export/obsidian", async (c) => {
    const ws = c.get("workspaceId");
    const files = await withWorkspace(ws, async (tx) => {
      const ids = await tx.execute<{ id: string }>(sql`select id from entities where workspace_id = ${ws} order by name`);
      const out: { path: string; content: string }[] = [];
      for (const { id } of ids) {
        const note = await loadNote(tx, ws, id);
        if (note) out.push({ path: noteFileName(note.name), content: renderNoteMarkdown(note) });
      }
      return out;
    });
    if (c.req.query("format") === "json") return c.json({ files });
    const zip = zipSync(Object.fromEntries(files.map((f) => [`Strata/${f.path}`, strToU8(f.content)])));
    return c.body(zip, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="strata-vault.zip"`,
    });
  });
