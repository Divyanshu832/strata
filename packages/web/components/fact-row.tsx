"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { NoteFact } from "@stratamem/sdk";
import { editFactStatement, endFact, forgetFact, pinFact } from "@/app/actions";
import { day, predicateLabel, typeColor, statementText } from "@/lib/format";

/** One current fact on a note: "lives in [[Pune]] since 1 May 2026", with its actions. */
export function FactRow({ fact }: { fact: NoteFact }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const [text, setText] = useState(fact.statement);
  const [pending, start] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && (setMenu(false), setConfirmForget(false));
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const conflict = fact.status === "contradiction";

  return (
    <li
      className={`group relative flex items-start gap-3 rounded-lg px-3 py-2.5 ${
        conflict ? "bg-cinnabar-soft ring-1 ring-cinnabar/30" : "hover:bg-panel"
      } ${pending ? "opacity-50" : ""}`}
    >
      <span className="mt-[3px] w-[108px] shrink-0 text-[13px] text-muted">{predicateLabel(fact.predicate)}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                await editFactStatement(fact.id, text);
                setEditing(false);
              });
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              className="min-w-0 flex-1 rounded-md border border-line-strong bg-sunk px-2 py-1 text-[14px] outline-none focus:border-ochre"
            />
            <button className="rounded-md bg-ochre px-2.5 text-[13px] font-medium text-sunk">Save</button>
          </form>
        ) : (
          <>
            <p className="text-[14.5px] leading-snug">
              {fact.objectId ? (
                <Link href={`/notes/${fact.objectId}`} className="wikilink inline-flex items-center gap-1.5">
                  <span className="size-[6px] rounded-full" style={{ background: typeColor(fact.objectType ?? "thing") }} />
                  {fact.objectName}
                </Link>
              ) : (
                <span>{fact.objectValue}</span>
              )}
              {fact.pinned && <span className="ml-2 text-[12px] text-ochre" title="Pinned: never merged or summarised away">pinned</span>}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {statementText(fact.statement)}
              <span className="text-faint"> · since {day(fact.validFrom)}</span>
              {fact.sourceId && (
                <>
                  <span className="text-faint"> · </span>
                  <Link href={`/sources/${fact.sourceId}`} className="text-faint underline-offset-2 hover:text-soft hover:underline">
                    source
                  </Link>
                </>
              )}
            </p>
            {conflict && <p className="mt-1 text-[12.5px] text-cinnabar">Conflicts with another value. <Link href="/review" className="underline underline-offset-2">Review</Link></p>}
          </>
        )}
      </div>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label="Fact actions"
          aria-expanded={menu}
          className="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-soft focus-visible:opacity-100 aria-expanded:opacity-100"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
          </svg>
        </button>
        {menu && (
          <div className="absolute top-8 right-0 z-20 w-56 overflow-hidden rounded-lg border border-line-strong bg-raised p-1 text-[13px] shadow-[0_16px_40px_-10px_rgba(0,0,0,0.6)]">
            <MenuItem onClick={() => (setMenu(false), setEditing(true))}>Edit wording</MenuItem>
            <MenuItem onClick={() => (setMenu(false), start(() => pinFact(fact.id, !fact.pinned)))}>{fact.pinned ? "Unpin" : "Pin (keep forever)"}</MenuItem>
            <MenuItem onClick={() => (setMenu(false), start(() => endFact(fact.id)))}>No longer true (keep as history)</MenuItem>
            <div className="my-1 border-t border-line" />
            {confirmForget ? (
              <MenuItem danger onClick={() => (setMenu(false), start(() => forgetFact(fact.id)))}>
                Forget permanently? Click to confirm
              </MenuItem>
            ) : (
              <MenuItem danger onClick={() => setConfirmForget(true)}>Forget…</MenuItem>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-md px-2.5 py-1.5 text-left ${danger ? "text-cinnabar hover:bg-cinnabar-soft" : "text-soft hover:bg-hover hover:text-text"}`}
    >
      {children}
    </button>
  );
}
