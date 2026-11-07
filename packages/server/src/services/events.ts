// Live updates: the web app's graph and note list subscribe (GET /v1/events, server-sent events) and
// see new memories as agents write them. In-process pub/sub is enough: one API process owns all writes.
import { EventEmitter } from "node:events";

export type MemoryEvent =
  | { type: "facts"; sourceId: string; added: number; updated: number; history: number; contradictions: number; entityIds: string[] }
  | { type: "chunks"; sourceId: string; chunks: number }
  | { type: "changed"; target: "fact" | "entity"; id: string; action: string };

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function publish(workspaceId: string, event: MemoryEvent): void {
  bus.emit(workspaceId, event);
}

export function subscribe(workspaceId: string, fn: (e: MemoryEvent) => void): () => void {
  bus.on(workspaceId, fn);
  return () => bus.off(workspaceId, fn);
}
