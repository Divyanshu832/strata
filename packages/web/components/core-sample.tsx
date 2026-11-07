import Link from "next/link";
import type { NoteFact } from "@stratamem/sdk";
import { day, month, predicateLabel, typeHex } from "@/lib/format";

/**
 * A "core sample" for every relation that has changed over time: one strip per predicate, cut into the
 * values it held, oldest on the left. "lives in: Bhopal (Jan 2025 → May 2026) | Pune (since May 2026)".
 */
export function CoreSample({ facts }: { facts: NoteFact[] }) {
  const byPredicate = new Map<string, NoteFact[]>();
  for (const f of facts) {
    if (f.kind === "event" || f.status === "merged") continue;
    // A rejected conflict never held (closed the moment it started): not part of the history.
    if (f.validTo && +new Date(f.validTo) <= +new Date(f.validFrom)) continue;
    byPredicate.set(f.predicate, [...(byPredicate.get(f.predicate) ?? []), f]);
  }
  const changed = [...byPredicate.entries()].filter(([, fs]) => fs.some((f) => f.validTo !== null));
  if (changed.length === 0) return null;

  const now = Date.now();
  const all = changed.flatMap(([, fs]) => fs);
  const start = Math.min(...all.map((f) => +new Date(f.validFrom)));
  const span = Math.max(now - start, 86_400_000);
  const pct = (t: number) => ((t - start) / span) * 100;

  return (
    <div className="space-y-4">
      {changed.map(([predicate, fs]) => {
        const ordered = [...fs].sort((a, b) => +new Date(a.validFrom) - +new Date(b.validFrom));
        return (
          <div key={predicate}>
            <p className="mb-1.5 text-[13px] text-muted">{predicateLabel(predicate)}</p>
            <div className="relative h-9 overflow-hidden rounded-md bg-sunk ring-1 ring-line">
              {ordered.map((f) => {
                const from = +new Date(f.validFrom);
                const to = f.validTo ? +new Date(f.validTo) : now;
                const color = typeHex(f.objectType ?? "thing");
                const label = f.objectName ?? f.objectValue ?? "";
                const inner = (
                  <span className="block truncate px-2 text-[12.5px] leading-9 font-medium text-text">{label}</span>
                );
                return (
                  <div
                    key={f.id}
                    className="absolute inset-y-0 border-r-2 border-sunk"
                    style={{
                      left: `${f.validTo ? pct(from) : Math.min(pct(from), 94)}%`,
                      width: `${Math.max(pct(to) - pct(from), f.validTo ? 0.8 : 6)}%`,
                      background: f.validTo
                        ? `repeating-linear-gradient(135deg, ${color}38 0 6px, ${color}26 6px 12px)`
                        : `${color}55`,
                      boxShadow: f.status === "contradiction" ? "inset 0 0 0 1.5px var(--cinnabar)" : undefined,
                    }}
                    title={`${label}: ${day(f.validFrom)} → ${f.validTo ? day(f.validTo) : "now"}`}
                  >
                    {f.objectId ? <Link href={`/notes/${f.objectId}`} className="block h-full hover:bg-white/5">{inner}</Link> : inner}
                  </div>
                );
              })}
            </div>
            <ol className="mt-1.5 space-y-0.5 text-[12.5px] text-muted">
              {[...ordered].reverse().map((f) => (
                <li key={f.id} className="flex gap-2">
                  <span className="w-[150px] shrink-0 text-faint">
                    {month(f.validFrom)} → {f.validTo ? month(f.validTo) : "now"}
                  </span>
                  <span className={f.validTo ? "" : "text-soft"}>
                    {f.objectName ?? f.objectValue}
                    {f.sourceId && (
                      <Link href={`/sources/${f.sourceId}`} className="ml-2 text-faint hover:text-soft hover:underline">
                        source
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
