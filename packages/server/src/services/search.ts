// Step 3 of the read path: hybrid search over facts. Each channel returns its own ranked list;
// rrf() merges them. All filtering (workspace, scope, validity in time) happens in SQL.
import { sql, type SQL } from "drizzle-orm";
import { at, texts, uuids, type Tx } from "../db/client.js";
import { toVector } from "./embed.js";
import type { Ranked } from "./rrf.js";
import type { Route } from "./router.js";

export type Filters = { workspaceId: string; scopes?: string[]; route: Route };

const LIMIT = 30;

/** Which facts count as "true" for this query: current by default, or inside the asked-for time. */
export function validityClause(route: Route): SQL {
  if (route.asOf) {
    return sql`f.valid_from <= ${at(route.asOf)} and (f.valid_to is null or f.valid_to > ${at(route.asOf)})`;
  }
  if (route.range?.from || route.range?.to) {
    const from = route.range.from ?? new Date(0);
    const to = route.range.to ?? new Date();
    // Events happened on a day: inside the window. Other facts: true at some point during it.
    return sql`(case when f.kind = 'event'
      then f.valid_from >= ${at(from)} and f.valid_from < ${at(to)}
      else f.valid_from < ${at(to)} and (f.valid_to is null or f.valid_to > ${at(from)}) end)`;
  }
  if (route.type === "temporal" || route.type === "count" || route.type === "episodic") {
    return sql`true`; // history questions may need replaced facts too
  }
  return sql`f.valid_to is null`;
}

function base(filters: Filters): SQL {
  const scope = filters.scopes?.length ? sql`and f.scope = any(${texts(filters.scopes)})` : sql``;
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

/**
 * Full-text query with OR between words: a question shares only some words with the memory that
 * answers it ("Where does Harshit live?" vs "Harshit lives in Pune"). ts_rank puts better overlaps first.
 * Stop words are dropped by Postgres. Returns null when nothing searchable is left.
 */
export function anyWords(query: string): SQL | null {
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => w.length > 1).slice(0, 32);
  return words.length ? sql`to_tsquery('english', ${words.join(" | ")})` : null;
}

export async function textSearch(tx: Tx, filters: Filters, query: string): Promise<Ranked[]> {
  const q = anyWords(query);
  if (!q) return [];
  const rows = await tx.execute<{ id: string; score: number }>(sql`
    select f.id, ts_rank(f.tsv, ${q}) as score
    from facts f
    where ${base(filters)} and f.tsv @@ ${q}
    order by score desc
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: r.id, channel: "text", rank: i + 1, score: Number(r.score) }));
}

/** Entities whose name or alias appears in the query. */
export async function entitiesInQuery(tx: Tx, workspaceId: string, query: string): Promise<{ id: string; name: string }[]> {
  const rows = await tx.execute<{ id: string; name: string }>(sql`
    select e.id, e.name from entities e
    where e.workspace_id = ${workspaceId}
      and (position(lower(e.name) in lower(${query})) > 0
        or exists (select 1 from unnest(e.aliases) a where length(a) > 2 and position(lower(a) in lower(${query})) > 0)
        or word_similarity(e.name, ${query}) > 0.7)
    limit 10`);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** One hop: facts where a mentioned entity is the subject or the object. */
export async function graphSearch(tx: Tx, filters: Filters, entityIds: string[]): Promise<Ranked[]> {
  if (entityIds.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`
    select f.id from facts f
    where ${base(filters)} and (f.subject_id = any(${uuids(entityIds)}) or f.object_id = any(${uuids(entityIds)}))
    order by f.pinned desc, f.valid_from desc
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: r.id, channel: "graph", rank: i + 1, score: 1 }));
}

// --- Raw-text chunks (sources stored without facts: no extractor, imports) -------------------

/** Chunks have no valid time; date questions filter on when the source happened. */
function chunkBase(filters: Filters): SQL {
  const scope = filters.scopes?.length ? sql`and c.scope = any(${texts(filters.scopes)})` : sql``;
  const r = filters.route;
  const time = r.asOf
    ? sql`and src.occurred_at <= ${at(r.asOf)}`
    : r.range?.from || r.range?.to
      ? sql`and src.occurred_at >= ${at(r.range.from ?? new Date(0))} and src.occurred_at < ${at(r.range.to ?? new Date())}`
      : sql``;
  return sql`c.workspace_id = ${filters.workspaceId} ${scope} ${time}`;
}

/** Chunk ids are prefixed "c:" so they never collide with fact ids in the fused list. */
export async function chunkVectorSearch(tx: Tx, filters: Filters, queryVec: number[]): Promise<Ranked[]> {
  const rows = await tx.execute<{ id: string; score: number }>(sql`
    select c.id, 1 - (c.embedding <=> ${toVector(queryVec)}::vector) as score
    from chunks c join sources src on src.id = c.source_id
    where ${chunkBase(filters)} and c.embedding is not null
    order by c.embedding <=> ${toVector(queryVec)}::vector
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: `c:${r.id}`, channel: "vector", rank: i + 1, score: Number(r.score) }));
}

export async function chunkTextSearch(tx: Tx, filters: Filters, query: string): Promise<Ranked[]> {
  const q = anyWords(query);
  if (!q) return [];
  const rows = await tx.execute<{ id: string; score: number }>(sql`
    select c.id, ts_rank(c.tsv, ${q}) as score
    from chunks c join sources src on src.id = c.source_id
    where ${chunkBase(filters)} and c.tsv @@ ${q}
    order by score desc
    limit ${LIMIT}`);
  return rows.map((r, i) => ({ id: `c:${r.id}`, channel: "text", rank: i + 1, score: Number(r.score) }));
}
