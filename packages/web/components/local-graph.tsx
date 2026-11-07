"use client";

import { useRouter } from "next/navigation";
import type { Graph } from "@stratamem/sdk";
import { GraphView } from "./force-graph";

/** The small graph in a note's side panel: its direct links, the open note ringed. */
export function LocalGraph({ graph, focusId }: { graph: Graph; focusId: string }) {
  const router = useRouter();
  if (graph.edges.length === 0) return <p className="text-[12.5px] text-faint">No links yet.</p>;
  return (
    <div className="h-[260px] overflow-hidden rounded-lg bg-sunk ring-1 ring-line">
      <GraphView graph={graph} focusId={focusId} showLinkLabels={graph.edges.length <= 8} onNodeClick={(id) => router.push(`/notes/${id}`)} />
    </div>
  );
}
