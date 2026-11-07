"use client";

import { useTransition } from "react";
import { resolveConflict } from "@/app/actions";

export function ReviewActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const act = (a: "accept" | "reject" | "keep_both") => start(() => resolveConflict(id, a));
  return (
    <div className={`flex flex-wrap gap-2 ${pending ? "pointer-events-none opacity-50" : ""}`}>
      <button onClick={() => act("accept")} className="rounded-md bg-ochre px-3 py-1.5 text-[13px] font-medium text-sunk">
        Use the new value
      </button>
      <button onClick={() => act("reject")} className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-soft hover:border-muted hover:text-text">
        Keep the earlier value
      </button>
      <button onClick={() => act("keep_both")} className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:text-text">
        Both are true
      </button>
    </div>
  );
}
