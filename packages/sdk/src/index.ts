// @stratamem/sdk: a thin typed client over the Strata REST API. Used by the MCP server and the web app.
import type {
  AnswerResult,
  Graph,
  Note,
  NoteSummary,
  RecallInput,
  RecallResult,
  RememberInput,
} from "./types.ts";

export type * from "./types.ts";

export class StrataError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Strata {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:8787").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new StrataError(res.status, err.error ?? res.statusText);
    }
    return (await res.json()) as T;
  }

  /** Store messages; facts are extracted in the background. */
  remember(input: RememberInput | RememberInput[]) {
    const body = Array.isArray(input) ? { items: input } : input;
    return this.request<{ sources: { id: string; duplicate: boolean }[] }>("POST", "/memories", body);
  }

  recall(input: RecallInput) {
    return this.request<RecallResult>("POST", "/recall", input);
  }

  answer(input: RecallInput & { model?: string }) {
    return this.request<AnswerResult>("POST", "/answer", input);
  }

  forget(factId: string) {
    return this.request<{ forgotten: string }>("DELETE", `/memories/${factId}`);
  }

  notes(q?: string) {
    return this.request<{ notes: NoteSummary[] }>("GET", `/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  note(id: string) {
    return this.request<{ note: Note; markdown: string }>("GET", `/notes/${id}`);
  }

  neighbours(id: string, hops = 2) {
    return this.request<{ graph: Graph; chain: string }>("GET", `/notes/${id}/neighbours?hops=${hops}`);
  }

  timeline(entityId: string) {
    return this.request<{ timeline: unknown[] }>("GET", `/entities/${entityId}/timeline`);
  }

  /** Whole graph, or as it was at `at` (ISO date). */
  graph(at?: string) {
    return this.request<Graph>("GET", `/graph${at ? `?at=${encodeURIComponent(at)}` : ""}`);
  }
}
