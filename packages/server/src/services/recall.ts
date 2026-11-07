// The read path, end to end: route → (SQL path) → hybrid search → fuse → rerank → connected chain
// → pack into the token budget → optional explain trace.
import { sql } from "drizzle-orm";
import { withWorkspace } from "../db/client.js";
import { estimateTokens } from "../lib/tokens.js";
import { DEFAULT_BUDGET, pack } from "./budget.js";
import { embed } from "./embed.js";
import { neighbours } from "./graph.js";
import { formatChain } from "./notes.js";
import { rerank } from "./rerank.js";
import { routeQuery, type Route } from "./router.js";
import { rrf, type Channel, type Ranked } from "./rrf.js";
import { entitiesInQuery, graphSearch, textSearch, vectorSearch, type Filters } from "./search.js";
import { countFacts, latestFact, type StructuredAnswer } from "./structured.js";

/** A vector-only hit needs at least this similarity to count as relevant. */
const MIN_VECTOR_SIMILARITY = 0.3;
/** The connected chain may use at most this share of the budget. */
const CHAIN_SHARE = 0.3;

export type RecallInput = {
  query: string;
  maxTokens?: number;
  scopes?: string[];
  hops?: number;
  explain?: boolean;
  now?: Date;
};

export type RecallItem = {
  id: string;
  text: string;
  score: number;
  subject: string;
  validFrom: string;
  validTo: string | null;
  status: string;
  source: { id: string; excerpt: string; occurredAt: string } | null;
  explain?: { channels: { channel: Channel; rank: number; score: number }[] };
};

export type RecallResult = {
  query: string;
  route: Route;
  answer?: StructuredAnswer; // set when the SQL path answered (counts, "when did I last")
  chain: string; // connected facts around the mentioned entities, as text
  items: RecallItem[];
  tokens: number;
  budget: number;
  explain?: {
    entities: string[];
    dropped: { id: string; reason: string }[];
    channelCounts: Record<Channel, number>;
  };
};

export async function recall(workspaceId: string, input: RecallInput): Promise<RecallResult> {
  const route = routeQuery(input.query, input.now);
  const budget = input.maxTokens ?? DEFAULT_BUDGET[route.type];
  const [queryVec] = await embed([input.query]);
  const filters: Filters = { workspaceId, scopes: input.scopes, route };

  return withWorkspace(workspaceId, async (tx) => {
    const entityIds = await entitiesInQuery(tx, workspaceId, input.query);

    // 1. SQL path for counts and "when did I last".
    let answer: StructuredAnswer | undefined;
    if (route.type === "count") answer = await countFacts(tx, filters, input.query, queryVec!, entityIds);
    else if (route.type === "temporal" && route.latest) answer = await latestFact(tx, filters, input.query, queryVec!, entityIds);

    // 2. Hybrid search, fused.
    const lists: Ranked[][] = [
      await vectorSearch(tx, filters, queryVec!),
      await textSearch(tx, filters, input.query),
      await graphSearch(tx, filters, entityIds),
    ];
    if (answer?.factIds.length) {
      lists.push(answer.factIds.map((id, i) => ({ id, channel: "sql" as const, rank: i + 1, score: 1 })));
    }
    const fused = rrf(lists);
    const channelCounts = { vector: lists[0]!.length, text: lists[1]!.length, graph: lists[2]!.length, sql: lists[3]?.length ?? 0 };

    // 3. Load the fused facts with their subject and source.
    const ids = fused.map((f) => f.id);
    const rows = ids.length
      ? await tx.execute<{
          id: string; statement: string; subject: string; subject_id: string; valid_from: string; valid_to: string | null;
          status: string; source_id: string | null; source_content: string | null; occurred_at: string | null;
        }>(sql`
          select f.id, f.statement, s.name as subject, f.subject_id, f.valid_from, f.valid_to, f.status,
                 f.source_id, src.content as source_content, src.occurred_at
          from facts f
          join entities s on s.id = f.subject_id
          left join sources src on src.id = f.source_id
          where f.id = any(${ids})`)
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    let items = fused.flatMap((f) => {
      const r = byId.get(f.id);
      if (!r) return [];
      const vectorOnly = f.channels.every((c) => c.channel === "vector");
      const relevant = !vectorOnly || (f.channels[0]?.score ?? 0) >= MIN_VECTOR_SIMILARITY;
      const item: RecallItem & { subjectId: string } = {
        id: r.id,
        text: r.valid_to
          ? `${r.statement} (${r.valid_from.slice(0, 10)} → ${r.valid_to.slice(0, 10)})`
          : `${r.statement} (since ${String(r.valid_from).slice(0, 10)})`,
        score: relevant ? f.score : 0,
        subject: r.subject,
        subjectId: r.subject_id,
        validFrom: new Date(r.valid_from).toISOString(),
        validTo: r.valid_to ? new Date(r.valid_to).toISOString() : null,
        status: r.status,
        source: r.source_id
          ? { id: r.source_id, excerpt: (r.source_content ?? "").slice(0, 280), occurredAt: new Date(r.occurred_at!).toISOString() }
          : null,
        explain: input.explain ? { channels: f.channels } : undefined,
      };
      return [item];
    });

    // 4. Optional rerank.
    items = await rerank(input.query, items);

    // 5. Connected chain around the mentioned entities (or the top results' subjects).
    const starts = entityIds.length ? entityIds : [...new Set(items.slice(0, 3).map((i) => i.subjectId))];
    let chain = formatChain(await neighbours(tx, workspaceId, starts, input.hops ?? 1), starts);
    const chainCap = Math.floor(budget * CHAIN_SHARE);
    if (estimateTokens(chain) > chainCap) chain = chain.slice(0, chainCap * 4);

    // 6. Pack the rest of the budget.
    const packed = pack(items, budget - estimateTokens(chain), Number.EPSILON);
    const result: RecallResult = {
      query: input.query,
      route,
      answer,
      chain,
      items: packed.kept.map(({ subjectId: _drop, ...rest }) => rest),
      tokens: packed.tokens + estimateTokens(chain),
      budget,
    };
    if (input.explain) result.explain = { entities: entityIds, dropped: packed.dropped, channelCounts };
    return result;
  });
}
