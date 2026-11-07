// The read path, end to end: route → (SQL path) → hybrid search over facts and raw-text chunks → fuse
// → rerank → connected chain → pack into the token budget → optional explain trace.
import { sql } from "drizzle-orm";
import { withWorkspace, uuids } from "../db/client.js";
import { estimateTokens } from "../lib/tokens.js";
import { DEFAULT_BUDGET, pack } from "./budget.js";
import { embedQuery } from "./embed.js";
import { neighbours } from "./graph.js";
import { formatChain, type Graph } from "./notes.js";
import { rerank, rerankEnabled } from "./rerank.js";
import { routeQuery, type Route } from "./router.js";
import { rrf, type Channel, type Ranked } from "./rrf.js";
import {
  chunkTextSearch,
  chunkVectorSearch,
  entitiesInQuery,
  graphSearch,
  textSearch,
  vectorSearch,
  type Filters,
} from "./search.js";
import { countFacts, latestFact, type StructuredAnswer } from "./structured.js";
import { logUsage } from "./usage.js";

/**
 * A hit found only by vector search needs at least this cosine similarity to count as relevant.
 * bge-small puts unrelated short facts at ~0.3-0.47 and related ones at ~0.5-0.8 (see handbook).
 */
const MIN_VECTOR_SIMILARITY = 0.55;
/** Chunks are longer, so their similarities run lower; they also need the text channel less. */
const MIN_CHUNK_SIMILARITY = 0.5;
/** The connected chain may use at most this share of the budget. */
const CHAIN_SHARE = 0.3;

export type RecallInput = {
  query: string;
  maxTokens?: number;
  scopes?: string[];
  hops?: number;
  explain?: boolean;
  /** Answer as memory stood at this moment (ISO date): time travel. */
  asOf?: string;
  now?: Date;
};

export type RecallItem = {
  id: string;
  type: "fact" | "chunk";
  text: string;
  score: number;
  subject: string | null;
  subjectId: string | null;
  objectId: string | null;
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
  latencyMs: number;
  explain?: {
    entities: { id: string; name: string }[];
    dropped: { id: string; text: string; reason: string }[];
    channelCounts: Record<Channel, number>;
    reranked: boolean;
    chainGraph: Graph; // what the chain walked: lets the web app light up the path on the graph
  };
};

type FactRow = {
  id: string; statement: string; subject: string; subject_id: string; object_id: string | null;
  valid_from: string; valid_to: string | null; status: string;
  source_id: string | null; source_content: string | null; occurred_at: string | null;
};
type ChunkRow = { id: string; content: string; source_id: string; occurred_at: string };

const iso = (v: string | Date) => new Date(v).toISOString();
const day = (v: string | Date) => iso(v).slice(0, 10);

export async function recall(workspaceId: string, input: RecallInput): Promise<RecallResult> {
  const started = performance.now();
  let route = routeQuery(input.query, input.now);
  if (input.asOf) route = { ...route, asOf: new Date(input.asOf), reason: `${route.reason}; as of ${input.asOf}` };
  const budget = input.maxTokens ?? DEFAULT_BUDGET[route.type];
  const queryVec = await embedQuery(input.query);
  const filters: Filters = { workspaceId, scopes: input.scopes, route };

  const result = await withWorkspace(workspaceId, async (tx) => {
    const entities = await entitiesInQuery(tx, workspaceId, input.query);
    const entityIds = entities.map((e) => e.id);

    // 1. SQL path for counts and "when did I last".
    let answer: StructuredAnswer | undefined;
    if (route.type === "count") answer = await countFacts(tx, filters, input.query, queryVec, entityIds);
    else if (route.type === "temporal" && route.latest) answer = await latestFact(tx, filters, input.query, queryVec, entityIds);

    // 2. Hybrid search over facts and chunks, fused.
    const [vec, text, graph, cVec, cText] = [
      await vectorSearch(tx, filters, queryVec),
      await textSearch(tx, filters, input.query),
      await graphSearch(tx, filters, entityIds),
      await chunkVectorSearch(tx, filters, queryVec),
      await chunkTextSearch(tx, filters, input.query),
    ];
    const lists: Ranked[][] = [vec, text, graph, cVec, cText];
    if (answer?.factIds.length) lists.push(answer.factIds.map((id, i) => ({ id, channel: "sql" as const, rank: i + 1, score: 1 })));
    const fused = rrf(lists);
    const channelCounts = {
      vector: vec.length + cVec.length,
      text: text.length + cText.length,
      graph: graph.length,
      sql: answer?.factIds.length ?? 0,
    };

    // 3. Load what was found.
    const factIds = fused.filter((f) => !f.id.startsWith("c:")).map((f) => f.id);
    const chunkIds = fused.filter((f) => f.id.startsWith("c:")).map((f) => f.id.slice(2));
    const factRows = factIds.length
      ? await tx.execute<FactRow>(sql`
          select f.id, f.statement, s.name as subject, f.subject_id, f.object_id, f.valid_from, f.valid_to, f.status,
                 f.source_id, src.content as source_content, src.occurred_at
          from facts f
          join entities s on s.id = f.subject_id
          left join sources src on src.id = f.source_id
          where f.id = any(${uuids(factIds)})`)
      : [];
    const chunkRows = chunkIds.length
      ? await tx.execute<ChunkRow>(sql`
          select c.id, c.content, c.source_id, src.occurred_at
          from chunks c join sources src on src.id = c.source_id
          where c.id = any(${uuids(chunkIds)})`)
      : [];
    const facts = new Map(factRows.map((r) => [r.id, r]));
    const chunks = new Map(chunkRows.map((r) => [`c:${r.id}`, r]));

    let items: RecallItem[] = fused.flatMap((f): RecallItem[] => {
      const vectorOnly = f.channels.every((c) => c.channel === "vector");
      const explain = input.explain ? { channels: f.channels } : undefined;
      const r = facts.get(f.id);
      if (r) {
        const relevant = !vectorOnly || (f.channels[0]?.score ?? 0) >= MIN_VECTOR_SIMILARITY;
        return [{
          id: r.id,
          type: "fact",
          text:
            (r.valid_to ? `${r.statement} (${day(r.valid_from)} → ${day(r.valid_to)})` : `${r.statement} (since ${day(r.valid_from)})`) +
            (r.status === "contradiction" ? " [conflicting, unreviewed]" : ""),
          score: relevant ? f.score : 0,
          subject: r.subject,
          subjectId: r.subject_id,
          objectId: r.object_id,
          validFrom: iso(r.valid_from),
          validTo: r.valid_to ? iso(r.valid_to) : null,
          status: r.status,
          source: r.source_id
            ? { id: r.source_id, excerpt: (r.source_content ?? "").slice(0, 280), occurredAt: iso(r.occurred_at!) }
            : null,
          explain,
        }];
      }
      const c = chunks.get(f.id);
      if (c) {
        const relevant = !vectorOnly || (f.channels[0]?.score ?? 0) >= MIN_CHUNK_SIMILARITY;
        return [{
          id: f.id,
          type: "chunk",
          text: `[${day(c.occurred_at)}] ${c.content}`,
          score: relevant ? f.score : 0,
          subject: null,
          subjectId: null,
          objectId: null,
          validFrom: iso(c.occurred_at),
          validTo: null,
          status: "source",
          source: { id: c.source_id, excerpt: c.content.slice(0, 280), occurredAt: iso(c.occurred_at) },
          explain,
        }];
      }
      return [];
    });

    // 4. Optional rerank (RERANKER=local).
    items = await rerank(input.query, items);

    // 5. Connected chain around the mentioned entities (or the top results' subjects), within its share.
    const starts = entityIds.length
      ? entityIds
      : [...new Set(items.filter((i) => i.score > 0 && i.subjectId).slice(0, 3).map((i) => i.subjectId!))];
    // "Where did I live in March 2025?" → the links as they stood at the end of that window.
    const now = input.now ?? new Date();
    const chainAt = route.asOf ?? (route.range?.to && route.range.to < now ? new Date(+route.range.to - 1) : undefined);
    const chainGraph = await neighbours(tx, workspaceId, starts, input.hops ?? 1, chainAt);
    const chain = trimLines(formatChain(chainGraph, starts, chainAt), Math.floor(budget * CHAIN_SHARE));

    // 6. Pack the rest of the budget.
    const packed = pack(items, budget - estimateTokens(chain), Number.EPSILON);
    const out: RecallResult = {
      query: input.query,
      route,
      answer,
      chain,
      items: packed.kept,
      tokens: packed.tokens + estimateTokens(chain),
      budget,
      latencyMs: 0,
    };
    if (input.explain) {
      const texts = new Map(items.map((i) => [i.id, i.text]));
      out.explain = {
        entities,
        dropped: packed.dropped.map((d) => ({ ...d, text: texts.get(d.id) ?? "" })),
        channelCounts,
        reranked: rerankEnabled(),
        chainGraph,
      };
    }
    return out;
  });

  result.latencyMs = Math.round(performance.now() - started);
  void logUsage(workspaceId, { kind: "recall", route: route.type, items: result.items.length, tokens: result.tokens, latencyMs: result.latencyMs });
  return result;
}

/** Keep whole lines while they fit in `maxTokens`. */
export function trimLines(text: string, maxTokens: number): string {
  const out: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const cost = estimateTokens(line + "\n");
    if (used + cost > maxTokens) break;
    out.push(line);
    used += cost;
  }
  return out.join("\n");
}
