"use client";

import { useMemo, useRef, useState } from "react";
import type { Graph } from "@stratamem/sdk";
import { day, month, TYPE_LABEL, TYPE_ORDER, typeHex } from "@/lib/format";

const W = 1000; // viewBox width; the SVG scales to its container
const SAMPLES = 96;

type Props = {
  graph: Graph;
  /** Cursor position. Omit for a read-only band. */
  value?: Date;
  onChange?: (d: Date) => void;
  height?: number;
};

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * Memory over time drawn as sediment: one layer per note type, its thickness the number of links that
 * were true at that moment. Drag the ochre cursor (or use the arrow keys) to move through time.
 */
export function StrataBand({ graph, value, onChange, height = 92 }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const H = height;
  const AXIS = 18;
  const plotH = H - AXIS;

  const { start, end, layers, max, ticks } = useMemo(() => {
    const times = graph.edges.flatMap((e) => [+new Date(e.validFrom), ...(e.validTo ? [+new Date(e.validTo)] : [])]);
    // Rounded to the hour so the server render and the browser agree.
    const now = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    const first = times.length ? Math.min(...times) : now - 30 * 86_400_000;
    const span = Math.max(now - first, 7 * 86_400_000);
    const start = first - span * 0.04;
    const end = now;
    const typeOf = new Map(graph.nodes.map((n) => [n.id, (TYPE_ORDER as readonly string[]).includes(n.type) ? n.type : "thing"]));
    const ts = Array.from({ length: SAMPLES }, (_, i) => start + ((end - start) * i) / (SAMPLES - 1));
    const counts = TYPE_ORDER.map((type) =>
      ts.map(
        (t) =>
          graph.edges.filter(
            (e) =>
              e.status !== "merged" &&
              typeOf.get(e.source) === type &&
              +new Date(e.validFrom) <= t &&
              (e.validTo === null || +new Date(e.validTo) > t),
          ).length,
      ),
    );
    const totals = ts.map((_, i) => counts.reduce((s, c) => s + c[i]!, 0));
    const max = Math.max(1, ...totals);
    // Stack from the bottom up: older, heavier material settles below.
    const base = ts.map(() => 0);
    const layers = TYPE_ORDER.map((type, li) => {
      const lower = [...base];
      counts[li]!.forEach((c, i) => (base[i]! += c));
      const upper = [...base];
      return { type, lower, upper, total: counts[li]!.reduce((a, b) => a + b, 0) };
    }).filter((l) => l.total > 0);

    // Month ticks (thinned to ~6)
    const ticks: { x: number; label: string }[] = [];
    const d = new Date(start);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const all: number[] = [];
    while (+d <= end) {
      all.push(+d);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    const step = Math.max(1, Math.ceil(all.length / 6));
    all.forEach((t, i) => i % step === 0 && ticks.push({ x: ((t - start) / (end - start)) * W, label: month(new Date(t)) }));
    return { start, end, layers, max, ticks };
  }, [graph]);

  const x = (i: number) => (i / (SAMPLES - 1)) * W;
  const y = (v: number) => plotH - (v / max) * (plotH - 8);
  const toDate = (px: number) => new Date(start + (Math.min(Math.max(px, 0), W) / W) * (end - start));
  const xOf = (d: Date) => ((+d - start) / (end - start)) * W;

  const pointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svg.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };

  const interactive = !!onChange && !!value;
  const cursorX = value ? xOf(value) : null;
  const atNow = value ? end - +value < 86_400_000 : true;

  return (
    <div className="select-none">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`block w-full ${interactive ? "cursor-ew-resize" : ""}`}
        style={{ height: H }}
        role={interactive ? "slider" : "img"}
        aria-label={interactive ? "Time: drag to see memory as it was" : "Memory over time"}
        aria-valuemin={interactive ? start : undefined}
        aria-valuemax={interactive ? end : undefined}
        aria-valuenow={interactive ? +value! : undefined}
        aria-valuetext={interactive ? day(value!) : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={(e) => {
          if (!interactive) return;
          const stepMs = (end - start) / 60;
          if (e.key === "ArrowLeft") onChange!(new Date(Math.max(start, +value! - stepMs)));
          if (e.key === "ArrowRight") onChange!(new Date(Math.min(end, +value! + stepMs)));
          if (e.key === "End") onChange!(new Date(end));
          if (e.key === "Home") onChange!(new Date(start));
        }}
        onPointerDown={(e) => {
          if (!interactive) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          onChange!(toDate(pointer(e)));
        }}
        onPointerMove={(e) => {
          setHoverX(pointer(e));
          if (interactive && e.buttons === 1) onChange!(toDate(pointer(e)));
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        <defs>
          {layers.map((l) => (
            <linearGradient key={l.type} id={`g-${l.type}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={typeHex(l.type)} stopOpacity="0.9" />
              <stop offset="1" stopColor={typeHex(l.type)} stopOpacity="0.55" />
            </linearGradient>
          ))}
        </defs>
        {/* bedrock line */}
        <line x1="0" x2={W} y1={plotH + 0.5} y2={plotH + 0.5} stroke="var(--line-strong)" />
        {layers.map((l) => {
          const top = smooth(l.upper.map((v, i) => [x(i), y(v)]));
          const bottom = smooth(l.lower.map((v, i) => [x(i), y(v)]).reverse() as [number, number][]);
          return (
            <path
              key={l.type}
              d={`${top} L${bottom.slice(1)} Z`}
              fill={`url(#g-${l.type})`}
              stroke="var(--shale-900)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            >
              <title>{TYPE_LABEL[l.type]}</title>
            </path>
          );
        })}
        {/* the future is unwritten: shade everything after the cursor */}
        {cursorX !== null && !atNow && <rect x={cursorX} y="0" width={W - cursorX} height={plotH} fill="var(--shale-900)" opacity="0.62" />}
        {ticks.map((t) => (
          <text key={t.x} x={t.x} y={H - 4} fontSize="10.5" fill="var(--faint)" textAnchor="middle" style={{ fontFamily: "inherit" }}>
            {t.label}
          </text>
        ))}
        {hoverX !== null && interactive && (
          <line x1={hoverX} x2={hoverX} y1="0" y2={plotH} stroke="var(--text-soft)" strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />
        )}
        {cursorX !== null && (
          <g>
            <line x1={cursorX} x2={cursorX} y1="0" y2={plotH} stroke="var(--ochre)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </g>
        )}
      </svg>
      {layers.length === 0 && <p className="mt-2 text-[12.5px] text-muted">Links between notes will build up here over time.</p>}
    </div>
  );
}

/** The legend for the band and the graph (also works as type filter when `hidden` is passed). */
export function TypeLegend({
  types,
  hidden,
  onToggle,
}: {
  types: string[];
  hidden?: Set<string>;
  onToggle?: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TYPE_ORDER.filter((t) => types.includes(t)).map((t) => {
        const off = hidden?.has(t);
        const Tag = onToggle ? "button" : "span";
        return (
          <Tag
            key={t}
            {...(onToggle ? { onClick: () => onToggle(t), "aria-pressed": !off } : {})}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px] ${
              off ? "border-line text-faint" : "border-line-strong text-soft"
            } ${onToggle ? "hover:border-muted" : ""}`}
          >
            <span className="size-[7px] rounded-full" style={{ background: off ? "transparent" : typeHex(t), boxShadow: `inset 0 0 0 1px ${typeHex(t)}` }} />
            {TYPE_LABEL[t]}
          </Tag>
        );
      })}
    </div>
  );
}
