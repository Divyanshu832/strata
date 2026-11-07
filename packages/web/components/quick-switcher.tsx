"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteSummary } from "@stratamem/sdk";
import { displayName, typeColor } from "@/lib/format";

type Option = { kind: "note"; note: NoteSummary } | { kind: "recall"; query: string };

/** Scores a name against the typed text: prefix > word start > substring > in-order letters. */
function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 4;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

/** ⌘K / Ctrl+K: jump to any note, or ask memory the typed question. */
export function QuickSwitcher({ notes }: { notes: NoteSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const options: Option[] = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matches = notes
      .map((n) => ({ n, s: query ? Math.max(score(displayName(n.name), query), ...n.aliases.map((a) => score(a, query) - 0.5)) : 1 }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s || b.n.facts + b.n.links - (a.n.facts + a.n.links))
      .slice(0, 8)
      .map((m): Option => ({ kind: "note", note: m.n }));
    return query ? [...matches, { kind: "recall", query: q.trim() }] : matches;
  }, [q, notes]);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    setOpen(false);
    router.push(o.kind === "note" ? `/notes/${o.note.id}` : `/recall?q=${encodeURIComponent(o.query)}`);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-left text-[13px] text-muted hover:border-line-strong hover:text-soft"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Find a note
        <kbd className="ml-auto rounded border border-line px-1.5 text-[11px] text-faint">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 px-4 pt-[14vh]" onMouseDown={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Find a note"
            className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, options.length - 1)));
                else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
                else if (e.key === "Enter") choose(options[sel]);
                else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Type a name, or ask a question…"
              className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[15px] outline-none placeholder:text-faint"
              role="combobox"
              aria-expanded
              aria-controls="qs-list"
            />
            <ul id="qs-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
              {options.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">No notes yet.</li>}
              {options.map((o, i) => (
                <li
                  key={o.kind === "note" ? o.note.id : "recall"}
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => choose(o)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[14px] ${i === sel ? "bg-raised" : ""}`}
                >
                  {o.kind === "note" ? (
                    <>
                      <span className="size-2 rounded-full" style={{ background: typeColor(o.note.type) }} />
                      <span>{displayName(o.note.name)}</span>
                      {o.note.aliases.length > 0 && <span className="truncate text-[12.5px] text-faint">{o.note.aliases.join(", ")}</span>}
                      <span className="ml-auto text-[12px] text-faint">{o.note.type}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-ochre">?</span>
                      <span className="truncate">
                        Ask memory: <span className="text-soft">{o.query}</span>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
