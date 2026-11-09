"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Graph } from "@stratamem/sdk";
import { day } from "@/lib/format";
import { GraphView } from "./force-graph";
import { MEMORY_EVENT } from "./live-refresh";
import { StrataBand, TypeLegend } from "./strata-band";

/** The Graph tab: the whole memory as a mesh, with the sediment band as a time slider. */
export function GraphExplorer({ initial, initialAt }: { initial: Graph; initialAt?: string }) {
  const router = useRouter();
  const [graph, setGraph] = useState(initial);
  const [at, setAt] = useState<Date | null>(initialAt ? new Date(initialAt) : null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // New memories appear live as agents write them.
  useEffect(() => {
    const reload = () => fetch("/api/graph").then((r) => (r.ok ? r.json() : null)).then((g) => g && setGraph(g));
    window.addEventListener(MEMORY_EVENT, reload);
    return () => window.removeEventListener(MEMORY_EVENT, reload);
  }, []);

  const now = new Date();
  const when = at ?? now;
  const isNow = !at || now.getTime() - at.getTime() < 86_400_000;

  const counts = useMemo(() => {
    const t = when.getTime();
    const live = graph.edges.filter((e) =>
      isNow ? e.validTo === null && e.status !== "merged" : +new Date(e.validFrom) <= t && (e.validTo === null || +new Date(e.validTo) > t),
    );
    const conflicts = live.filter((e) => e.status === "contradiction").length;
    const nodes = new Set(live.flatMap((e) => [e.source, e.target])).size;
    const mentions = live.filter((e) => e.predicate === "mentions").length;
    return { links: live.length - mentions, mentions, nodes, conflicts };
  }, [graph, when, isNow]);

  const types = [...new Set(graph.nodes.map((n) => n.type))];

  if (graph.nodes.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-lg font-semibold">The graph is empty</h1>
        <p className="mt-2 text-muted">
          Every person, project and place your agents remember becomes a node here, linked by the facts between them. Dotted lines are mentions: a fact about one note that names another.
          Connect an agent from the Overview page to start.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <GraphView
          graph={graph}
          at={isNow ? undefined : when}
          hiddenTypes={hidden}
          onNodeClick={(id) => router.push(`/notes/${id}`)}
          showLinkLabels={graph.edges.length < 40}
        />
        <div className="pointer-events-none absolute top-4 left-5">
          <p className="text-[22px] font-semibold tracking-tight">{isNow ? "Now" : day(when)}</p>
          <p className="text-[13px] text-muted">
            {counts.nodes} notes linked by {counts.links} facts{counts.mentions > 0 && ` and ${counts.mentions} mentions`}
            {counts.conflicts > 0 && <span className="text-cinnabar"> · {counts.conflicts} conflicting</span>}
          </p>
        </div>
        <div className="absolute top-4 right-5">
          <TypeLegend types={types} hidden={hidden} onToggle={(t) => setHidden((h) => {
            const n = new Set(h);
            if (n.has(t)) n.delete(t); else n.add(t);
            return n;
          })} />
        </div>
      </div>
      <div className="border-t border-line bg-sunk px-5 pt-3 pb-2">
        <div className="mb-1.5 flex items-center justify-between text-[12.5px] text-muted">
          <span>Drag through time. Replaced facts fade out; facts learned later appear.</span>
          {!isNow && (
            <button onClick={() => setAt(null)} className="rounded-md border border-line-strong px-2.5 py-0.5 text-soft hover:border-ochre hover:text-text">
              Back to now
            </button>
          )}
        </div>
        <StrataBand graph={graph} value={isNow ? null : when} onChange={setAt} />
      </div>
    </div>
  );
}
