"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Channel, Graph, RecallItem, RecallResult } from "@stratamem/sdk";
import { runRecall } from "@/app/actions";
import { day } from "@/lib/format";
import { GraphView } from "./force-graph";

const CHANNEL_LABEL: Record<Channel, string> = {
  vector: "meaning",
  text: "words",
  graph: "link",
  sql: "database",
};

const CHANNEL_HELP: Record<Channel, string> = {
  vector: "Found by meaning (embedding similarity)",
  text: "Found by matching words (full-text search)",
  graph: "Found by following a link from a note named in the question",
  sql: "Counted or dated by a SQL query",
};

const EXAMPLES = ["What am I working on?", "Where do I live?", "What did we decide last week?", "How many times did I go to the gym?"];

export function RecallLab({ graph, initialQuery }: { graph: Graph; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [budget, setBudget] = useState<number | null>(null);
  const [asOf, setAsOf] = useState("");
  const [result, setResult] = useState<RecallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (q = query) => {
    if (!q.trim()) return;
    start(async () => {
      const r = await runRecall({ query: q.trim(), maxTokens: budget ?? undefined, asOf: asOf || undefined });
      setError(r.error ?? null);
      setResult(r.result ?? null);
    });
  };

  useEffect(() => {
    if (initialQuery) run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const lit = useMemo(() => {
    if (!result) return null;
    const nodes = new Set<string>();
    const links = new Set<string>();
    for (const e of result.explain?.entities ?? []) nodes.add(e.id);
    for (const e of result.explain?.chainGraph.edges ?? []) links.add(e.id);
    for (const i of result.items) {
      links.add(i.id);
      if (i.subjectId) nodes.add(i.subjectId);
      if (i.objectId) nodes.add(i.objectId);
    }
    return { nodes, links };
  }, [result]);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="min-w-0 overflow-y-auto border-line px-6 py-7 lg:w-[56%] lg:border-r md:px-8">
        <h1 className="text-[26px] font-semibold tracking-tight">Ask memory</h1>
        <p className="mt-1 max-w-[62ch] text-muted">
          The same call your agents make. See which memories come back, how each was found, and what the token budget cut.
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask what an agent would ask"
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-sunk px-3.5 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-ochre"
            />
            <button disabled={pending} className="rounded-lg bg-ochre px-4 font-medium text-sunk disabled:opacity-60">
              {pending ? "Recalling…" : "Recall"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-muted">
            <label className="flex items-center gap-2">
              Budget
              <input
                type="range"
                min={200}
                max={8000}
                step={100}
                value={budget ?? 2500}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-32 accent-[var(--ochre)]"
              />
              <span className="w-24 text-soft">{budget ? `${budget} tokens` : "auto"}</span>
              {budget && (
                <button type="button" onClick={() => setBudget(null)} className="text-faint hover:text-soft">
                  reset
                </button>
              )}
            </label>
            <label className="flex items-center gap-2">
              As of
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="rounded-md border border-line bg-sunk px-2 py-0.5 text-soft [color-scheme:dark]"
              />
            </label>
          </div>
        </form>

        {!result && !pending && !error && (
          <div className="mt-8">
            <p className="mb-2 text-[13px] text-muted">Try</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => (setQuery(q), run(q))}
                  className="rounded-full border border-line px-3 py-1 text-[13px] text-soft hover:border-ochre hover:text-text"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-6 rounded-lg bg-cinnabar-soft px-4 py-3 text-[13.5px] text-cinnabar">{error}</p>}

        {result && <Trace result={result} onOpen={(id) => router.push(`/notes/${id}`)} />}
      </div>

      <div className="relative min-h-[360px] flex-1 bg-sunk">
        <GraphView graph={graph} highlightNodes={lit?.nodes} highlightLinks={lit?.links} onNodeClick={(id) => router.push(`/notes/${id}`)} />
        <p className="pointer-events-none absolute bottom-3 left-4 text-[12.5px] text-faint">
          {result ? "Lit: the notes and links this recall used." : "Run a recall to see its path through memory."}
        </p>
      </div>
    </div>
  );
}

function Trace({ result, onOpen }: { result: RecallResult; onOpen: (id: string) => void }) {
  const pct = Math.min(100, (result.tokens / result.budget) * 100);
  return (
    <div className="mt-8 space-y-7">
      <section className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[13px]">
        <span>
          <span className="text-muted">Question type </span>
          <span className="font-medium text-text">{result.route.type}</span>
          <span className="text-faint"> ({result.route.reason})</span>
        </span>
        <span className="text-muted">{result.latencyMs} ms</span>
      </section>

      <section>
        <div className="mb-1.5 flex justify-between text-[13px]">
          <span className="text-muted">Context returned</span>
          <span>
            <span className="font-medium">{result.tokens}</span>
            <span className="text-muted"> of {result.budget} tokens</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-ochre" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {result.answer && (
        <section className="rounded-lg border border-line-strong bg-panel px-5 py-4">
          <p className="text-[13px] text-muted">{result.answer.kind === "count" ? "Counted by the database" : "Latest match, from the database"}</p>
          <p className="mt-1 text-[30px] leading-none font-semibold tracking-tight">
            {result.answer.value === null ? "No match" : result.answer.kind === "latest" ? day(String(result.answer.value)) : result.answer.value}
          </p>
          <p className="mt-2 text-[12.5px] text-faint">
            From {result.answer.factIds.length} matching fact{result.answer.factIds.length === 1 ? "" : "s"}, cited below. No model counted anything.
          </p>
        </section>
      )}

      {result.explain && result.explain.entities.length > 0 && (
        <section className="text-[13px]">
          <span className="text-muted">Notes named in the question: </span>
          {result.explain.entities.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <button onClick={() => onOpen(e.id)} className="wikilink">
                {e.name === "user" ? "You" : e.name}
              </button>
            </span>
          ))}
        </section>
      )}

      {result.chain && (
        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Connected facts</h2>
          <pre className="rounded-lg bg-panel px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-soft">{result.chain}</pre>
        </section>
      )}

      <section>
        <h2 className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold">
          Memories <span className="text-[13px] font-normal text-faint">{result.items.length}</span>
        </h2>
        {result.items.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nothing relevant. Strata returns nothing rather than filler.</p>
        ) : (
          <ol className="space-y-2">
            {result.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ol>
        )}
      </section>

      {result.explain && result.explain.dropped.length > 0 && (
        <details className="rounded-lg ring-1 ring-line">
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] text-muted hover:text-soft">
            Left out: {result.explain.dropped.filter((d) => d.reason === "budget").length} over budget,{" "}
            {result.explain.dropped.filter((d) => d.reason === "below_threshold").length} not relevant enough
          </summary>
          <ul className="space-y-1 border-t border-line px-4 py-3 text-[12.5px]">
            {result.explain.dropped.map((d) => (
              <li key={d.id} className="flex gap-3">
                <span className={`w-20 shrink-0 ${d.reason === "budget" ? "text-ochre" : "text-faint"}`}>
                  {d.reason === "budget" ? "budget" : "irrelevant"}
                </span>
                <span className="truncate text-muted">{d.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: RecallItem }) {
  return (
    <li className="rounded-lg bg-panel px-4 py-2.5">
      <p className="text-[14px] leading-snug">{item.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        {item.type === "chunk" && <span className="rounded bg-raised px-1.5 text-muted">raw text</span>}
        {item.explain?.channels.map((c) => (
          <span key={c.channel} title={CHANNEL_HELP[c.channel]} className="rounded border border-line-strong px-1.5 text-soft">
            {CHANNEL_LABEL[c.channel]} #{c.rank}
            {c.channel === "vector" && <span className="text-faint"> {c.score.toFixed(2)}</span>}
          </span>
        ))}
        <span className="ml-auto text-faint">score {item.score.toFixed(3)}</span>
        {item.source && (
          <Link href={`/sources/${item.source.id}`} className="text-faint hover:text-soft hover:underline">
            source
          </Link>
        )}
      </div>
    </li>
  );
}
