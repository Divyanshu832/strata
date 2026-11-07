"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NoteSummary } from "@stratamem/sdk";
import { displayName, TYPE_LABEL, TYPE_ORDER, typeColor } from "@/lib/format";

/** Notes grouped by type, like folders in a vault. Groups collapse; the open note is highlighted. */
export function NoteList({ notes }: { notes: NoteSummary[] }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  if (notes.length === 0) {
    return (
      <p className="px-4 py-3 text-[13px] text-muted">
        No notes yet. They appear here as your agents remember things.
      </p>
    );
  }

  const groups = TYPE_ORDER.map((t) => ({
    type: t,
    notes: notes.filter((n) => (TYPE_ORDER as readonly string[]).includes(n.type) ? n.type === t : t === "thing").sort((a, b) =>
      a.name === "user" ? -1 : b.name === "user" ? 1 : a.name.localeCompare(b.name),
    ),
  })).filter((g) => g.notes.length);

  return (
    <nav aria-label="Notes" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {groups.map((g) => (
        <section key={g.type} className="mt-2">
          <button
            onClick={() => setClosed((c) => ({ ...c, [g.type]: !c[g.type] }))}
            aria-expanded={!closed[g.type]}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] font-medium text-muted hover:text-soft"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" className={`transition-transform ${closed[g.type] ? "-rotate-90" : ""}`} aria-hidden>
              <path d="M1 2.5 4 5.5 7 2.5" stroke="currentColor" fill="none" strokeWidth="1.3" />
            </svg>
            {TYPE_LABEL[g.type]}
            <span className="ml-auto text-faint">{g.notes.length}</span>
          </button>
          {!closed[g.type] && (
            <ul>
              {g.notes.map((n) => {
                const active = pathname === `/notes/${n.id}`;
                return (
                  <li key={n.id}>
                    <Link
                      href={`/notes/${n.id}`}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-2.5 rounded-md py-[5px] pr-2 pl-5 text-[13.5px] ${
                        active ? "bg-raised text-text" : "text-soft hover:bg-panel hover:text-text"
                      }`}
                    >
                      <span className="size-[7px] shrink-0 rounded-full" style={{ background: typeColor(n.type) }} />
                      <span className="truncate">{displayName(n.name)}</span>
                      {n.facts + n.links > 0 && <span className="ml-auto text-[11.5px] text-faint">{n.facts + n.links}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}
