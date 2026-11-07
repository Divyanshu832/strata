"use client";

import { useState } from "react";
import { num } from "@/lib/format";

type Day = { day: string; value: number; calls: number };

/** One series of daily bars with a hover tooltip. Days with no activity are drawn as gaps on the baseline. */
export function DailyBars({ days, unit, label }: { days: Day[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 160;
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...days.map((d) => d.value));
  const nice = niceMax(max);
  const bw = (W - pad.l - pad.r) / Math.max(days.length, 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const h = hover !== null ? days[hover] : null;

  return (
    <figure className="relative">
      <figcaption className="sr-only">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--line)" strokeDasharray={f ? "2 3" : undefined} />
            <text x={pad.l - 8} y={y(nice * f) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--faint)">
              {compact(nice * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad.l + i * bw;
          const top = y(d.value);
          const bh = Math.max(0, H - pad.b - top);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x + 1},${H - pad.b} V${top + 3} q0,-3 3,-3 H${x + bw - 4} q3,0 3,3 V${H - pad.b} Z`}
                  fill="var(--ochre)"
                  opacity={hover === null || hover === i ? 0.9 : 0.4}
                />
              )}
            </g>
          );
        })}
        {days.length > 0 && (
          <>
            <text x={pad.l} y={H - 6} fontSize="10.5" fill="var(--faint)">{days[0]!.day.slice(5)}</text>
            <text x={W - pad.r} y={H - 6} fontSize="10.5" fill="var(--faint)" textAnchor="end">{days.at(-1)!.day.slice(5)}</text>
          </>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-[12px] shadow-lg"
          style={{ left: `${((pad.l + (hover! + 0.5) * bw) / W) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="text-muted">{h.day}</p>
          <p>
            <span className="font-medium">{num(h.value)}</span> {unit}
          </p>
          <p className="text-muted">{num(h.calls)} calls</p>
        </div>
      )}
    </figure>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
const compact = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v)));
