// The SQL path: count and "when did I last" questions are answered by Postgres, not by an LLM
// counting retrieved text. The matched rows come back as citations so the answer can be checked.
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { toVector } from "./embed.js";
import { validityClause, type Filters } from "./search.js";

/** Minimum cosine similarity for a fact to count as "about" the question. Tuned on benchmarks. */
const MATCH_THRESHOLD = 0.45;

export type StructuredAnswer = {
  kind: "count" | "latest";
  value: number | string | null; // the count, or the ISO date of the latest match
  factIds: string[]; // the rows that were counted / the latest row
  sql: string; // shown in explain traces
};

/**
 * Facts that match the question: text match OR close embedding, inside the time filter,
 * restricted to the mentioned entities when there are any.
 */
function matchClause(filters: Filters, query: string, queryVec: number[], entityIds: string[]) {
  const entity = entityIds.length
    ? sql`and (f.subject_id = any(${entityIds}) or f.object_id = any(${entityIds}))`
    : sql``;
  return sql`
    f.workspace_id = ${filters.workspaceId}
    and ${validityClause(filters.route)}
    ${entity}
    and (f.tsv @@ websearch_to_tsquery('english', ${query})
         or 1 - (f.embedding <=> ${toVector(queryVec)}::vector) > ${MATCH_THRESHOLD})`;
}

export async function countFacts(
  tx: Tx,
  filters: Filters,
  query: string,
  queryVec: number[],
  entityIds: string[],
): Promise<StructuredAnswer> {
  const rows = await tx.execute<{ id: string }>(sql`
    select f.id from facts f
    where ${matchClause(filters, query, queryVec, entityIds)}
      and f.status <> 'replaced'
    order by f.valid_from`);
  return {
    kind: "count",
    value: rows.length,
    factIds: rows.map((r) => r.id),
    sql: "select count(*) from facts where <match> and <time window> and status <> 'replaced'",
  };
}

export async function latestFact(
  tx: Tx,
  filters: Filters,
  query: string,
  queryVec: number[],
  entityIds: string[],
): Promise<StructuredAnswer> {
  const rows = await tx.execute<{ id: string; valid_from: string }>(sql`
    select f.id, f.valid_from from facts f
    where ${matchClause(filters, query, queryVec, entityIds)}
    order by f.valid_from desc
    limit 1`);
  const row = rows[0];
  return {
    kind: "latest",
    value: row ? new Date(row.valid_from).toISOString() : null,
    factIds: row ? [row.id] : [],
    sql: "select * from facts where <match> order by valid_from desc limit 1",
  };
}
