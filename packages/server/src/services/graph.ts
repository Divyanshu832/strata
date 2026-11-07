// Database side of notes and graph: load notes, neighbours (server-side link following), full graph.
import { sql } from "drizzle-orm";
import { at, uuids, type Tx } from "../db/client.js";
import type { Backlink, Graph, GraphEdge, GraphNode, NoteFact, NoteInput } from "./notes.js";

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
  return { nodes: await loadNodes(tx, workspaceId), edges: edges.map(toEdge) };
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
