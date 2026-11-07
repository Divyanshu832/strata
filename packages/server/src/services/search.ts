// Step 3 of the read path: hybrid search over facts. Each channel returns its own ranked list;
// rrf() merges them. All filtering (workspace, scope, validity in time) happens in SQL.
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { toVector } from "./embed.js";
import type { Ranked } from "./rrf.js";
import type { Route } from "./router.js";

export type Filters = { workspaceId: string; scopes?: string[]; route: Route };

const LIMIT = 30;

/** Which facts count as "true" for this query: current by default, or inside the asked-for time. */
export function validityClause(route: Route): SQL {
  if (route.asOf) {
    return sql`f.valid_from <= ${route.asOf} and (f.valid_to is null or f.valid_to > ${route.asOf})`;
  }
  if (route.range?.from || route.range?.to) {
    const from = route.range.from ?? new Date(0);
    const to = route.range.to ?? new Date();
    return sql`f.valid_from < ${to} and (f.valid_to is null or f.valid_to > ${from})`;
  }
  if (route.type === "temporal" || route.type === "count" || route.type === "episodic") {
    return sql`true`; // history questions may need replaced facts too
  }
  return sql`f.valid_to is null`;
}

function base(filters: Filters): SQL {
  const scope = filters.scopes?.length ? sql`and f.scope = any(${filters.scopes})` : sql``;
  return sql`f.workspace_id = ${filters.workspaceId} ${scope} and ${validityClause(filters.route)}`;
}

export async function vectorSearch(tx: Tx, filters: Filters, queryVec: number[]): Promise<Ranked[]> {
  const rows = await tx.execute<{ id: string; score: number }>(sql`
    select f.id, 1 - (f.embedding <=> ${toVector(queryVec)}::vector) as score
    from facts f
    where ${base(filters)} and f.embedding is not null
    order by f.embedding <=> ${toVector(queryVec)}::vector
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: r.id, channel: "vector", rank: i + 1, score: Number(r.score) }));
}

export async function textSearch(tx: Tx, filters: Filters, query: string): Promise<Ranked[]> {
  const rows = await tx.execute<{ id: string; score: number }>(sql`
    select f.id, ts_rank(f.tsv, websearch_to_tsquery('english', ${query})) as score
    from facts f
    where ${base(filters)} and f.tsv @@ websearch_to_tsquery('english', ${query})
    order by score desc
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: r.id, channel: "text", rank: i + 1, score: Number(r.score) }));
}

/** Entities whose name or alias appears in the query. */
export async function entitiesInQuery(tx: Tx, workspaceId: string, query: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select e.id from entities e
    where e.workspace_id = ${workspaceId}
      and (position(lower(e.name) in lower(${query})) > 0
        or exists (select 1 from unnest(e.aliases) a where length(a) > 2 and position(lower(a) in lower(${query})) > 0)
        or word_similarity(e.name, ${query}) > 0.7)
    limit 10`);
  return rows.map((r) => r.id);
}

/** One hop: facts where a mentioned entity is the subject or the object. */
export async function graphSearch(tx: Tx, filters: Filters, entityIds: string[]): Promise<Ranked[]> {
  if (entityIds.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`
    select f.id from facts f
    where ${base(filters)} and (f.subject_id = any(${entityIds}) or f.object_id = any(${entityIds}))
    order by f.pinned desc, f.valid_from desc
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: r.id, channel: "graph", rank: i + 1, score: 1 }));
}
