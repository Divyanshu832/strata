import type { Metadata } from "next";
import Link from "next/link";
import { DailyBars } from "@/components/usage-chart";
import { Maintenance } from "@/components/maintenance";
import { strata } from "@/lib/strata";
import { ago, num, usd } from "@/lib/format";

export const metadata: Metadata = { title: "Usage" };

const DEFAULT_BUDGET: Record<string, number> = { count: 800, temporal: 1500, lookup: 1000, episodic: 3000, open: 2500 };
const KIND_LABEL: Record<string, string> = {
  recall: "Recalls",
  remember: "Writes",
  answer: "Answers (server model)",
  extract: "Extractions (server model)",
};

function lastDays(n: number) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export default async function UsagePage() {
  const [usage, status, { audit }] = await Promise.all([strata.usage(30), strata.status(), strata.audit()]);
  const recall = usage.totals.find((t) => t.kind === "recall");
  const cost = usage.totals.reduce((s, t) => s + t.costUsd, 0);
  const days = lastDays(30).map((day) => {
    const d = usage.days.find((x) => x.day === day && x.kind === "recall");
    return { day, value: d?.tokens ?? 0, calls: d?.calls ?? 0 };
  });

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-8">
      <h1 className="text-[26px] font-semibold tracking-tight">Usage</h1>
      <p className="mt-1 text-muted">Last 30 days. How much context your agents pulled from memory, how fast, and what it cost.</p>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4">
        <Tile label="Recalls" value={num(recall?.calls ?? 0)} />
        <Tile label="Tokens per recall" value={num(recall?.avgTokens ?? 0)} note="average context handed to the agent" />
        <Tile label="Recall latency" value={`${recall?.p50Ms ?? 0} ms`} note={`p95 ${recall?.p95Ms ?? 0} ms`} />
        <Tile label="Model cost" value={usd(cost)} note={status.extractor === "none" && !status.answer ? "no server model in use" : "OpenRouter, as billed"} />
      </dl>

      <section className="mt-10">
        <h2 className="text-[15px] font-semibold">Context tokens returned per day</h2>
        <p className="mb-3 text-[13px] text-muted">Everything recall handed to agents, summed per day.</p>
        <DailyBars days={days} unit="tokens" label="Recall tokens per day, last 30 days" />
      </section>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="mb-2 border-b border-line pb-2 text-[15px] font-semibold">Tokens by question type</h2>
          {usage.routes.length === 0 ? (
            <p className="text-[13px] text-muted">No recalls yet.</p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-normal">Type</th>
                  <th className="py-1 text-right font-normal">Recalls</th>
                  <th className="py-1 text-right font-normal">Avg tokens</th>
                  <th className="py-1 text-right font-normal">Budget</th>
                </tr>
              </thead>
              <tbody>
                {usage.routes.map((r) => (
                  <tr key={r.route} className="border-t border-line">
                    <td className="py-1.5">{r.route}</td>
                    <td className="py-1.5 text-right">{num(r.calls)}</td>
                    <td className="py-1.5 text-right">{num(r.avgTokens)}</td>
                    <td className="py-1.5 text-right text-muted">{num(DEFAULT_BUDGET[r.route] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 className="mt-8 mb-2 border-b border-line pb-2 text-[15px] font-semibold">All calls</h2>
          <table className="w-full text-[13px]">
            <tbody>
              {usage.totals.map((t) => (
                <tr key={t.kind} className="border-t border-line first:border-0">
                  <td className="py-1.5">{KIND_LABEL[t.kind] ?? t.kind}</td>
                  <td className="py-1.5 text-right">{num(t.calls)}</td>
                  <td className="py-1.5 text-right text-muted">p50 {t.p50Ms} ms</td>
                  <td className="py-1.5 text-right text-muted">{usd(t.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 border-b border-line pb-2 text-[15px] font-semibold">Setup</h2>
          <dl className="space-y-1.5 text-[13px]">
            <Row k="Extraction" v={status.extractor === "none" ? "by your agents (no server model)" : "Strata extractor via OpenRouter"} />
            <Row k="Embeddings" v={`${status.embeddingModel}, on this machine`} />
            <Row k="Reranker" v={status.reranker ?? "off"} />
            <Row k="Answer endpoint" v={status.answer ? "on" : "off (no OpenRouter key)"} />
            <Row k="Waiting to process" v={`${status.pendingSources} source${status.pendingSources === 1 ? "" : "s"}`} />
          </dl>

          <h2 className="mt-8 mb-3 border-b border-line pb-2 text-[15px] font-semibold">Maintenance</h2>
          <Maintenance />
          <p className="mt-4 text-[13px]">
            <a href="/api/export" className="wikilink">Download as an Obsidian vault</a>
            <span className="text-muted"> (.zip of markdown notes with [[links]])</span>
          </p>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="mb-2 border-b border-line pb-2 text-[15px] font-semibold">Change log</h2>
        <p className="mb-2 text-[13px] text-muted">Every edit, merge, review decision and forget.</p>
        {audit.length === 0 ? (
          <p className="text-[13px] text-faint">No changes yet.</p>
        ) : (
          <ul className="text-[13px]">
            {audit.slice(0, 30).map((a) => (
              <li key={a.id} className="grid grid-cols-[110px_150px_1fr] gap-3 border-t border-line py-1.5 first:border-0">
                <span className="text-muted">{ago(a.at)}</span>
                <span>{a.action.replace("review:", "review: ").replace("_", " ")}</span>
                <span className="truncate text-muted">
                  {a.targetType}{" "}
                  {a.targetType === "entity" && a.action !== "merge" ? (
                    <Link href={`/notes/${a.targetId}`} className="hover:text-soft hover:underline">{a.targetId.slice(0, 8)}</Link>
                  ) : (
                    a.targetId.slice(0, 8)
                  )}{" "}
                  by {a.actor}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-panel px-5 py-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-1 text-[24px] font-semibold tracking-tight">{value}</dd>
      {note && <dd className="text-[12px] text-faint">{note}</dd>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-soft">{v}</dd>
    </div>
  );
}
