"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "@stratamem/sdk";
import { displayName, predicateLabel, typeHex } from "@/lib/format";

// The canvas library touches `window`, so it only loads in the browser.
// Typed loosely: dynamic() drops the library's generics, and our accessors use our own node/link types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import("./force-graph-canvas"), { ssr: false }) as unknown as React.ComponentType<any>;

type N = { id: string; name: string; type: string; degree: number; x?: number; y?: number };
type L = { id: string; source: string | N; target: string | N; predicate: string; status: string; validFrom: string; validTo: string | null };

const endId = (v: string | N) => (typeof v === "string" ? v : v.id);

export type GraphViewProps = {
  graph: Graph;
  /** Show links as they were at this moment (time slider). Default: current links only. */
  at?: Date;
  /** Nodes / links to light up (recall path). Everything else dims when set. */
  highlightNodes?: Set<string>;
  highlightLinks?: Set<string>;
  /** Node drawn larger with a ring (the open note). */
  focusId?: string;
  hiddenTypes?: Set<string>;
  onNodeClick?: (id: string) => void;
  /** Always show link labels (small graphs). Otherwise they appear when zoomed in or on hover. */
  showLinkLabels?: boolean;
  className?: string;
};

export function GraphView({
  graph,
  at,
  highlightNodes,
  highlightLinks,
  focusId,
  hiddenTypes,
  onNodeClick,
  showLinkLabels,
  className,
}: GraphViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable copies: the layout library mutates them, and keeping identity stable keeps the layout stable
  // while the time slider moves (links are hidden, not removed).
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({ ...n })) as N[],
      links: graph.edges.map((e) => ({ ...e })) as L[],
    }),
    [graph],
  );

  // Fit the whole graph in view once the layout has mostly settled (and again if the data changes).
  const ready = size.w > 0;
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => fg.current?.zoomToFit(500, 56), 900);
    return () => clearTimeout(timer);
  }, [data, ready]);

  const t = at ? +at : null;
  const linkLive = (l: L) => {
    if (t === null) return l.validTo === null && l.status !== "merged";
    return +new Date(l.validFrom) <= t && (l.validTo === null || +new Date(l.validTo) > t);
  };
  const nodeType = useMemo(() => new Map(data.nodes.map((n) => [n.id, n.type])), [data]);
  const linkShown = (l: L) =>
    linkLive(l) && !hiddenTypes?.has(nodeType.get(endId(l.source)) ?? "") && !hiddenTypes?.has(nodeType.get(endId(l.target)) ?? "");

  // Nodes that have a visible link (or are focused/highlighted) are drawn at full strength.
  const live = useMemo(() => {
    const s = new Set<string>();
    for (const l of data.links) if (linkShown(l)) (s.add(endId(l.source)), s.add(endId(l.target)));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t, hiddenTypes]);

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const l of data.links) {
      if (!linkShown(l)) continue;
      if (endId(l.source) === hover) s.add(endId(l.target));
      if (endId(l.target) === hover) s.add(endId(l.source));
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, data, t, hiddenTypes]);

  const lit = (id: string) => (neighbours ? neighbours.has(id) : highlightNodes ? highlightNodes.has(id) : true);


  return (
    <div ref={box} className={className ?? "h-full w-full"}>
      {size.w > 0 && (
        <ForceGraph2D
          fgRef={fg}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={120}
          nodeId="id"
          nodeVal={(n: N) => 1 + Math.sqrt(n.degree)}
          nodeVisibility={(n: N) => !hiddenTypes?.has(n.type)}
          linkVisibility={(l: L) => linkShown(l)}
          onNodeHover={(n: N | null) => setHover(n?.id ?? null)}
          onNodeClick={(n: N) => onNodeClick?.(n.id)}
          linkColor={(l: L) => {
            const on = lit(endId(l.source)) && lit(endId(l.target)) && (!highlightLinks || neighbours || highlightLinks.has(l.id));
            if (l.status === "contradiction") return on ? "#ec6a5e" : "#ec6a5e40";
            if (highlightLinks?.has(l.id) && !neighbours) return "#e2ab4c";
            return on ? "rgba(183,194,193,0.38)" : "rgba(183,194,193,0.07)";
          }}
          linkWidth={(l: L) => (highlightLinks?.has(l.id) && !neighbours ? 2.2 : 1)}
          linkLineDash={(l: L) => (l.status === "contradiction" ? [3, 3] : null)}
          linkDirectionalArrowLength={3.2}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalParticles={(l: L) => (highlightLinks?.has(l.id) && !neighbours ? 2 : 0)}
          linkDirectionalParticleColor={() => "#e2ab4c"}
          linkDirectionalParticleWidth={2.5}
          nodeCanvasObject={(n: N, ctx: CanvasRenderingContext2D, scale: number) => {
            const r = 3.2 + Math.sqrt(n.degree) * 1.6 + (n.id === focusId ? 2 : 0);
            const strong = lit(n.id) && (live.has(n.id) || n.id === focusId || highlightNodes?.has(n.id));
            ctx.globalAlpha = strong ? 1 : 0.18;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
            ctx.fillStyle = typeHex(n.type);
            ctx.fill();
            if (n.id === focusId || (highlightNodes?.has(n.id) && !neighbours)) {
              ctx.lineWidth = 1.6 / scale + 0.6;
              ctx.strokeStyle = "#e2ab4c";
              ctx.beginPath();
              ctx.arc(n.x!, n.y!, r + 2.6, 0, 2 * Math.PI);
              ctx.stroke();
            }
            const showLabel = scale > 1.1 || n.degree >= 3 || n.id === hover || n.id === focusId || (strong && !!(neighbours || highlightNodes));
            if (showLabel) {
              const size = Math.max(11 / scale, 2.4);
              ctx.font = `${n.id === focusId ? 600 : 450} ${size}px Geologica, system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = strong ? "#e3e8e5" : "#84959a";
              ctx.fillText(displayName(n.name), n.x!, n.y! + r + 2.5 / scale + 1);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n: N, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, 7 + Math.sqrt(n.degree) * 1.6, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(l: L, ctx: CanvasRenderingContext2D, scale: number) => {
            const s = l.source as N;
            const e = l.target as N;
            if (typeof s !== "object" || typeof e !== "object") return;
            const hovered = hover && (s.id === hover || e.id === hover);
            const pathLit = highlightLinks?.has(l.id) && !neighbours;
            if (!(showLinkLabels || scale > 2.2 || hovered || pathLit)) return;
            const size = Math.max(9 / scale, 1.8);
            ctx.font = `400 ${size}px Geologica, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const x = (s.x! + e.x!) / 2;
            const y = (s.y! + e.y!) / 2;
            const label = predicateLabel(l.predicate);
            const w = ctx.measureText(label).width + 4 / scale;
            ctx.fillStyle = "rgba(16,23,26,0.85)";
            ctx.fillRect(x - w / 2, y - size * 0.7, w, size * 1.4);
            ctx.fillStyle = l.status === "contradiction" ? "#ec6a5e" : pathLit ? "#e2ab4c" : "#b7c2c1";
            ctx.fillText(label, x, y);
          }}
        />
      )}
    </div>
  );
}
