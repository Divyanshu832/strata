"use client";

import { useState, useTransition } from "react";
import type { DuplicatePair } from "@stratamem/sdk";
import { mergeDuplicates } from "@/app/actions";

/** Find near-duplicate facts, show them, merge on confirmation (nothing is deleted). */
export function Maintenance() {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className={pending ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => start(async () => (setDone(null), setPairs((await mergeDuplicates(true)).pairs)))}
          className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-soft hover:border-muted hover:text-text"
        >
          Find duplicate facts
        </button>
        {pairs && pairs.length > 0 && (
          <button
            onClick={() => start(async () => (setDone((await mergeDuplicates(false)).pairs.length), setPairs(null)))}
            className="rounded-md bg-ochre px-3 py-1.5 text-[13px] font-medium text-sunk"
          >
            Merge {pairs.length}
          </button>
        )}
        <span className="text-[12.5px] text-faint">Also runs every night at 03:30.</span>
      </div>
      {done !== null && <p className="mt-3 text-[13px] text-malachite">Merged {done} duplicate{done === 1 ? "" : "s"}. The originals stay in history.</p>}
      {pairs && pairs.length === 0 && <p className="mt-3 text-[13px] text-muted">No duplicates found.</p>}
      {pairs && pairs.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {pairs.map((p) => (
            <li key={p.dupId} className="rounded-md bg-sunk px-3 py-2">
              <p>{p.keep}</p>
              <p className="text-muted">
                ≈ {p.dup} <span className="text-faint">({(p.similarity * 100).toFixed(0)}% similar)</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
