// Usage log: every remember / recall / answer / extract call, with tokens, cost and latency.
// Feeds the Usage tab and the "tokens per answer" numbers. Logging never fails a request.
import { sql } from "drizzle-orm";
import { withWorkspace, at } from "../db/client.js";
import { usageEvents } from "../db/schema.js";

export type UsageKind = "remember" | "recall" | "answer" | "extract";

export type UsageEvent = {
  kind: UsageKind;
  route?: string;
  items?: number;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
};

export async function logUsage(workspaceId: string, e: UsageEvent): Promise<void> {
  try {
    await withWorkspace(workspaceId, (tx) =>
      tx.insert(usageEvents).values({
        workspaceId,
        kind: e.kind,
        route: e.route,
        items: e.items ?? 0,
        tokens: e.tokens ?? 0,
        inputTokens: e.inputTokens ?? 0,
        outputTokens: e.outputTokens ?? 0,
        costUsd: e.costUsd ?? 0,
        latencyMs: Math.round(e.latencyMs ?? 0),
      }),
    );
  } catch (err) {
    console.error("[usage]", err);
  }
}

export type UsageDay = {
  day: string;
  kind: UsageKind;
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  p50Ms: number;
  p95Ms: number;
};

export type UsageSummary = {
  days: UsageDay[];
  totals: { kind: UsageKind; calls: number; tokens: number; avgTokens: number; costUsd: number; p50Ms: number; p95Ms: number }[];
  routes: { route: string; calls: number; avgTokens: number }[];
};

export async function usageSummary(workspaceId: string, days = 30): Promise<UsageSummary> {
  const since = new Date(Date.now() - days * 86_400_000);
  return withWorkspace(workspaceId, async (tx) => {
    const daily = await tx.execute<Record<string, string | number>>(sql`
      select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, kind, count(*)::int as calls,
        sum(tokens)::int as tokens, sum(input_tokens)::int as input_tokens, sum(output_tokens)::int as output_tokens,
        sum(cost_usd)::float8 as cost_usd,
        percentile_cont(0.5) within group (order by latency_ms)::int as p50,
        percentile_cont(0.95) within group (order by latency_ms)::int as p95
      from usage_events where workspace_id = ${workspaceId} and at >= ${at(since)}
      group by 1, 2 order by 1`);
    const totals = await tx.execute<Record<string, string | number>>(sql`
      select kind, count(*)::int as calls, sum(tokens)::int as tokens, avg(tokens)::float8 as avg_tokens,
        sum(cost_usd)::float8 as cost_usd,
        percentile_cont(0.5) within group (order by latency_ms)::int as p50,
        percentile_cont(0.95) within group (order by latency_ms)::int as p95
      from usage_events where workspace_id = ${workspaceId} and at >= ${at(since)}
      group by kind order by kind`);
    const routes = await tx.execute<Record<string, string | number>>(sql`
      select route, count(*)::int as calls, avg(tokens)::float8 as avg_tokens
      from usage_events where workspace_id = ${workspaceId} and at >= ${at(since)} and kind = 'recall' and route is not null
      group by route order by calls desc`);
    const n = (v: unknown) => Number(v ?? 0);
    return {
      days: daily.map((r) => ({
        day: String(r.day), kind: r.kind as UsageKind, calls: n(r.calls), tokens: n(r.tokens),
        inputTokens: n(r.input_tokens), outputTokens: n(r.output_tokens), costUsd: n(r.cost_usd), p50Ms: n(r.p50), p95Ms: n(r.p95),
      })),
      totals: totals.map((r) => ({
        kind: r.kind as UsageKind, calls: n(r.calls), tokens: n(r.tokens), avgTokens: Math.round(n(r.avg_tokens)),
        costUsd: n(r.cost_usd), p50Ms: n(r.p50), p95Ms: n(r.p95),
      })),
      routes: routes.map((r) => ({ route: String(r.route), calls: n(r.calls), avgTokens: Math.round(n(r.avg_tokens)) })),
    };
  });
}
