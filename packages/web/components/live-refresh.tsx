"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Event name broadcast in the page when memory changes; the graph listens for it too. */
export const MEMORY_EVENT = "strata:memory";

/**
 * Subscribes to the API's live events (via /api/events) and refreshes server-rendered pages when an
 * agent writes or someone edits. Bursts are coalesced into one refresh.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/events");
    const onChange = (e: MessageEvent) => {
      window.dispatchEvent(new CustomEvent(MEMORY_EVENT, { detail: JSON.parse(e.data) }));
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    for (const type of ["facts", "chunks", "changed"]) source.addEventListener(type, onChange);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [router]);
  return null;
}
