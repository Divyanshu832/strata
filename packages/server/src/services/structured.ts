// The SQL path: "how many times" and "when did I last" questions are answered by Postgres, not by an LLM
// counting retrieved text. The matched rows come back as citations so the answer can be checked.
//
// How a question becomes a count:
//   1. Find the single event that best matches the question (closest in meaning, inside the time window,
//      touching the notes named in the question).
//   2. Count every event of the same kind: same subject, same predicate, same object.
//      "How many times did I go climbing?" → best match "visited Bloco" → count all (user, visited, Bloco).
//   Grouping is what keeps unrelated-but-similar facts out of the count.
//   No matching event → no database answer (null), and recall falls back to search. Counting plain facts
//   ("how many projects do I lead?") needs real understanding; a wrong number is worse than none.
import { sql, type SQL } from "drizzle-orm";
import { uuids, type Tx } from "../db/client.js";
import { toVector } from "./embed.js";
import { validityClause, type Filters } from "./search.js";

/** An event must be at least this close in meaning (or share words) to be "the thing asked about". */
const EVENT_MATCH = 0.5;

export type StructuredAnswer = {
  kind: "count" | "latest";
  value: number | string | null; // the count, or the ISO date of the latest match
  factIds: string[]; // the rows that were counted / the latest row
  matched?: string; // the statement of the event that defined what was counted
  sql: string; // shown in explain traces
};

function scopeClause(filters: Filters, entityIds: string[]): SQL {
  const entity = entityIds.length ? sql`and (f.subject_id = any(${uuids(entityIds)}) or f.object_id = any(${uuids(entityIds)}))` : sql``;
  return sql`f.workspace_id = ${filters.workspaceId} and ${validityClause(filters.route)} and f.status not in ('replaced', 'merged') ${entity}`;
}

type Group = { subject_id: string; predicate: string; object_key: string; statement: string };

/** The event that best matches the question, as its (subject, predicate, object) group. */
async function bestEvent(tx: Tx, filters: Filters, query: string, queryVec: number[], entityIds: string[]): Promise<Group | null> {
  const vec = toVector(queryVec);
  const [row] = await tx.execute<Group>(sql`
    select f.subject_id, f.predicate, coalesce(f.object_id::text, lower(f.object_value)) as object_key, f.statement
    from facts f
    where ${scopeClause(filters, entityIds)} and f.kind = 'event'
      and (f.tsv @@ websearch_to_tsquery('english', ${query}) or 1 - (f.embedding <=> ${vec}::vector) > ${EVENT_MATCH})
    order by f.embedding <=> ${vec}::vector
    limit 1`);
  return row ?? null;
}

function groupClause(g: Group): SQL {
  return sql`f.kind = 'event' and f.subject_id = ${g.subject_id} and f.predicate = ${g.predicate}
    and coalesce(f.object_id::text, lower(f.object_value)) = ${g.object_key}`;
}

export async function countFacts(tx: Tx, filters: Filters, query: string, queryVec: number[], entityIds: string[]): Promise<StructuredAnswer | undefined> {
  const g = await bestEvent(tx, filters, query, queryVec, entityIds);
  if (!g) return undefined;
  const rows = await tx.execute<{ id: string }>(sql`
    select f.id from facts f where ${scopeClause(filters, [])} and ${groupClause(g)} order by f.valid_from`);
  return {
    kind: "count",
    value: rows.length,
    factIds: rows.map((r) => r.id),
    matched: g.statement,
    sql: "select count(*) from facts where kind = 'event' and (subject, predicate, object) = <best match> and <time window>",
  };
}

export async function latestFact(tx: Tx, filters: Filters, query: string, queryVec: number[], entityIds: string[]): Promise<StructuredAnswer | undefined> {
  const g = await bestEvent(tx, filters, query, queryVec, entityIds);
  if (!g) return undefined;
  const [row] = await tx.execute<{ id: string; valid_from: string }>(sql`
    select f.id, f.valid_from from facts f where ${scopeClause(filters, [])} and ${groupClause(g)}
    order by f.valid_from desc limit 1`);
  return {
    kind: "latest",
    value: row ? new Date(row.valid_from).toISOString() : null,
    factIds: row ? [row.id] : [],
    matched: g.statement,
    sql: "select max(valid_from) from facts where kind = 'event' and (subject, predicate, object) = <best match>",
  };
}
