// Obsidian-like API for the web app and agents: notes, links, backlinks, graph, timeline, export.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sql } from "drizzle-orm";
import { withWorkspace } from "../db/client.js";
import type { AuthVars } from "../lib/auth.js";
import { fullGraph, loadNote, neighbours } from "../services/graph.js";
import { formatChain, graphAt, noteFileName, renderNoteMarkdown } from "../services/notes.js";

export const notes = new Hono<{ Variables: AuthVars }>()
  // Note list for the sidebar / quick switcher.
  .get("/notes", async (c) => {
    const ws = c.get("workspaceId");
    const q = c.req.query("q");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute<{ id: string; name: string; type: string; tags: string[]; facts: number }>(sql`
        select e.id, e.name, e.type, e.tags,
          (select count(*) from facts f where f.subject_id = e.id and f.valid_to is null)::int as facts
        from entities e
        where e.workspace_id = ${ws} ${q ? sql`and (e.name ilike ${"%" + q + "%"} or ${q} ilike any(e.aliases))` : sql``}
        order by e.updated_at desc limit 500`),
    );
    return c.json({ notes: rows });
  })

  // One note: structured data + Obsidian-compatible markdown.
  .get("/notes/:id", async (c) => {
    const ws = c.get("workspaceId");
    const note = await withWorkspace(ws, (tx) => loadNote(tx, ws, c.req.param("id")));
    if (!note) throw new HTTPException(404, { message: "not found" });
    return c.json({ note, markdown: renderNoteMarkdown(note) });
  })

  // Server-side link following: the connected chain around a note.
  .get("/notes/:id/neighbours", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const hops = Math.min(Number(c.req.query("hops") ?? 2), 3);
    const graph = await withWorkspace(ws, (tx) => neighbours(tx, ws, [id], hops));
    return c.json({ graph, chain: formatChain(graph, [id]) });
  })

  // Everything that happened to an entity, in time order (as subject or object).
  .get("/entities/:id/timeline", async (c) => {
    const ws = c.get("workspaceId");
    const id = c.req.param("id");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select f.id, f.statement, f.predicate, f.valid_from, f.valid_to, f.recorded_at, f.status, f.source_id
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

  // Contradictions to review.
  .get("/review", async (c) => {
    const ws = c.get("workspaceId");
    const rows = await withWorkspace(ws, (tx) =>
      tx.execute(sql`
        select f.id, f.statement, f.valid_from, f.subject_id, s.name as subject, f.predicate, f.source_id
        from facts f join entities s on s.id = f.subject_id
        where f.workspace_id = ${ws} and f.status = 'contradiction'
        order by f.recorded_at desc`),
    );
    return c.json({ contradictions: rows });
  })

  // Obsidian vault export: one markdown file per note.
  .get("/export/obsidian", async (c) => {
    const ws = c.get("workspaceId");
    const files = await withWorkspace(ws, async (tx) => {
      const ids = await tx.execute<{ id: string }>(sql`select id from entities where workspace_id = ${ws}`);
      const out: { path: string; content: string }[] = [];
      for (const { id } of ids) {
        const note = await loadNote(tx, ws, id);
        if (note) out.push({ path: noteFileName(note.name), content: renderNoteMarkdown(note) });
      }
      return out;
    });
    // TODO(W4): stream a .zip instead of JSON.
    return c.json({ files });
  });
