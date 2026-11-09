// Database side of notes and graph: load notes, neighbours (server-side link following), full graph.
import { sql } from "drizzle-orm";
import { at, uuids, type Tx } from "../db/client.js";
import type { Backlink, Graph, GraphDetail, GraphEdge, GraphNode, NoteFact, NoteInput } from "./notes.js";

type EdgeRow = {
  id: string;
  subject_id: string;
  object_id: string;
  predicate: string;
  valid_from: string;
  valid_to: string | null;
  status: GraphEdge["status"];
};

const toEdge = (r: EdgeRow): GraphEdge => ({
  id: r.id,
  source: r.subject_id,
  target: r.object_id,
  predicate: r.predicate,
  validFrom: new Date(r.valid_from),
  validTo: r.valid_to ? new Date(r.valid_to) : null,
  status: r.status,
});

async function loadNodes(tx: Tx, workspaceId: string, ids?: string[]): Promise<GraphNode[]> {
  const filter = ids ? sql`and e.id = any(${uuids(ids)})` : sql``;
  const rows = await tx.execute<{ id: string; name: string; type: string; degree: number }>(sql`
    select e.id, e.name, e.type,
      (select count(*) from facts f where f.workspace_id = e.workspace_id
         and (f.subject_id = e.id or f.object_id = e.id) and f.valid_to is null)::int as degree
    from entities e where e.workspace_id = ${workspaceId} ${filter}`);
  return rows.map((r) => ({ ...r, degree: Number(r.degree) }));
}

/** Whole graph: all entities, all entity-to-entity facts (current and past, for the time slider). */
export async function fullGraph(tx: Tx, workspaceId: string): Promise<Graph> {
  const edges = await tx.execute<EdgeRow>(sql`
    select id, subject_id, object_id, predicate, valid_from, valid_to, status
    from facts where workspace_id = ${workspaceId} and object_id is not null`);
  return {
    nodes: await loadNodes(tx, workspaceId),
    edges: [...edges.map(toEdge), ...(await mentionEdges(tx, workspaceId))],
    details: await detailFacts(tx, workspaceId),
  };
}

/** Each note's plain-value facts (newest 40 per note), for the zoomed-in view of the graph. */
async function detailFacts(tx: Tx, workspaceId: string): Promise<GraphDetail[]> {
  const rows = await tx.execute<{
    id: string; subject_id: string; predicate: string; object_value: string | null; statement: string;
    valid_from: string; valid_to: string | null; status: GraphDetail["status"];
  }>(sql`
    select id, subject_id, predicate, object_value, statement, valid_from, valid_to, status from (
      select f.*, row_number() over (partition by f.subject_id order by f.valid_to is not null, f.valid_from desc) as n
      from facts f where f.workspace_id = ${workspaceId} and f.object_id is null and f.status <> 'merged'
    ) x where n <= 40`);
  const short = (s: string) => (s.length > 64 ? `${s.slice(0, 61).trimEnd()}…` : s);
  return rows.map((r) => ({
    id: r.id,
    entityId: r.subject_id,
    predicate: r.predicate,
    label: short(r.object_value ?? r.statement),
    statement: r.statement,
    validFrom: new Date(r.valid_from),
    validTo: r.valid_to ? new Date(r.valid_to) : null,
    status: r.status,
  }));
}

/**
 * Like Obsidian's mentions: a fact about one note whose text names another note links the two, so notes
 * connected only through descriptions ("Andrea Rimmaudo and Valerio Manueddu want …") still join the graph.
 * One link per pair, from the earliest fact that mentions it; skipped where a direct link already exists.
 */
async function mentionEdges(tx: Tx, workspaceId: string): Promise<GraphEdge[]> {
  const notes = await tx.execute<{ id: string; name: string; aliases: string[] }>(sql`
    select id, name, aliases from entities where workspace_id = ${workspaceId} and name <> 'user'`);
  const facts = await tx.execute<EdgeRow & { object_id: string | null; text: string }>(sql`
    select id, subject_id, object_id, predicate, valid_from, valid_to, status,
      statement || ' ' || coalesce(object_value, '') as text
    from facts where workspace_id = ${workspaceId} and status <> 'merged'
    order by valid_to is not null, valid_from`);
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = notes.map((n) => ({
    id: n.id,
    re: new RegExp(`(^|[^\\p{L}\\p{N}])(${[n.name, ...n.aliases].filter((x) => x.length >= 3).map(escape).join("|")})($|[^\\p{L}\\p{N}])`, "iu"),
  })).filter((p) => !p.re.source.includes("()"));
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set(facts.filter((f) => f.object_id).map((f) => pair(f.subject_id, f.object_id!)));
  const edges: GraphEdge[] = [];
  for (const f of facts) {
    for (const p of patterns) {
      if (p.id === f.subject_id || p.id === f.object_id || seen.has(pair(f.subject_id, p.id)) || !p.re.test(f.text)) continue;
      seen.add(pair(f.subject_id, p.id));
      edges.push(toEdge({ ...f, id: `${f.id}:${p.id}`, object_id: p.id, predicate: "mentions" }));
    }
  }
  return edges;
}

/**
 * Follow links on the server, `hops` steps out from the start entities, current facts only.
 * This is what lets an agent get the connected chain in one call instead of clicking around.
 */
export async function neighbours(tx: Tx, workspaceId: string, startIds: string[], hops = 2, asOf?: Date): Promise<Graph> {
  if (startIds.length === 0) return { nodes: [], edges: [] };
  // Current links, or the links that were true at `asOf`.
  const valid = asOf
    ? sql`f.valid_from <= ${at(asOf)} and (f.valid_to is null or f.valid_to > ${at(asOf)})`
    : sql`f.valid_to is null`;
  const rows = await tx.execute<EdgeRow>(sql`
    with recursive walk(entity_id, depth) as (
      select unnest(${uuids(startIds)}), 0
      union
      select case when f.subject_id = w.entity_id then f.object_id else f.subject_id end, w.depth + 1
      from walk w
      join facts f on f.workspace_id = ${workspaceId} and ${valid} and f.object_id is not null
        and (f.subject_id = w.entity_id or f.object_id = w.entity_id)
      where w.depth < ${hops}
    )
    select distinct f.id, f.subject_id, f.object_id, f.predicate, f.valid_from, f.valid_to, f.status
    from facts f
    where f.workspace_id = ${workspaceId} and ${valid} and f.object_id is not null
      and f.subject_id in (select entity_id from walk) and f.object_id in (select entity_id from walk)`);
  const edges = rows.map(toEdge);
  const ids = [...new Set([...startIds, ...edges.flatMap((e) => [e.source, e.target])])];
  return { nodes: await loadNodes(tx, workspaceId, ids), edges };
}

export async function loadNote(tx: Tx, workspaceId: string, entityId: string): Promise<(NoteInput & { id: string }) | null> {
  const [entity] = await tx.execute<{ id: string; name: string; type: string; aliases: string[]; tags: string[] }>(sql`
    select id, name, type, aliases, tags from entities where workspace_id = ${workspaceId} and id = ${entityId}`);
  if (!entity) return null;

  const factRows = await tx.execute<{
    id: string; predicate: string; statement: string; object_id: string | null; object_name: string | null;
    object_value: string | null; valid_from: string; valid_to: string | null; status: NoteFact["status"]; source_id: string | null;
    object_type: string | null; kind: NoteFact["kind"]; pinned: boolean;
  }>(sql`
    select f.id, f.predicate, f.statement, f.object_id, o.name as object_name, o.type as object_type, f.object_value,
           f.valid_from, f.valid_to, f.status, f.source_id, f.kind, f.pinned
    from facts f left join entities o on o.id = f.object_id
    where f.workspace_id = ${workspaceId} and f.subject_id = ${entityId}
    order by f.valid_from desc`);

  const backRows = await tx.execute<{ fact_id: string; from_id: string; from_name: string; from_type: string; predicate: string }>(sql`
    select f.id as fact_id, s.id as from_id, s.name as from_name, s.type as from_type, f.predicate
    from facts f join entities s on s.id = f.subject_id
    where f.workspace_id = ${workspaceId} and f.object_id = ${entityId} and f.valid_to is null`);

  const facts: NoteFact[] = factRows.map((r) => ({
    id: r.id,
    predicate: r.predicate,
    statement: r.statement,
    objectId: r.object_id,
    objectName: r.object_name,
    objectValue: r.object_value,
    validFrom: new Date(r.valid_from),
    validTo: r.valid_to ? new Date(r.valid_to) : null,
    status: r.status,
    sourceId: r.source_id,
    objectType: r.object_type,
    kind: r.kind,
    pinned: r.pinned,
  }));
  const backlinks: Backlink[] = backRows.map((r) => ({
    factId: r.fact_id, fromId: r.from_id, fromName: r.from_name, fromType: r.from_type, predicate: r.predicate,
  }));
  return { ...entity, facts, backlinks };
}
