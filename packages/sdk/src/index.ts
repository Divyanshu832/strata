// @stratamem/sdk: a thin typed client over the Strata REST API. Used by the MCP server and the web app.
import type {
  AnswerResult,
  AuditEntry,
  Contradiction,
  DuplicatePair,
  FactDetail,
  FactPatch,
  Graph,
  Note,
  NotePatch,
  NoteSummary,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
  SourceSummary,
  Source,
  Stats,
  Status,
  TimelineEntry,
  Usage,
} from "./types.ts";

export type * from "./types.ts";

export class StrataError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  return s.size ? `?${s}` : "";
};

export class Strata {
  readonly baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:8787").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  /** Raw request, for anything not wrapped below. Returns the Response for non-JSON bodies. */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...init.headers },
      cache: "no-store",
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new StrataError(res.status, err.error ?? res.statusText);
    }
    return res;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as T;
  }

  // --- Memory ---------------------------------------------------------------------------------

  /** Store facts your agent extracted (saved right away) and/or raw text (processed in the background). */
  remember(input: RememberInput | RememberInput[]) {
    const body = Array.isArray(input) ? { items: input } : input;
    return this.request<RememberResult>("POST", "/memories", body);
  }

  recall(input: RecallInput) {
    return this.request<RecallResult>("POST", "/recall", input);
  }

  /** Answer from memory with the server's model (needs OPENROUTER_API_KEY on the server). */
  answer(input: RecallInput & { model?: string }) {
    return this.request<AnswerResult>("POST", "/answer", input);
  }

  facts(opts: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
    return this.request<{ facts: (FactDetail["fact"] & { subjectId: string })[] }>("GET", `/memories${qs(opts)}`);
  }

  fact(id: string) {
    return this.request<FactDetail>("GET", `/memories/${id}`);
  }

  editFact(id: string, patch: FactPatch) {
    return this.request<{ fact: FactDetail["fact"] }>("PATCH", `/memories/${id}`, patch);
  }

  /** Permanently forget one fact (the only real delete; logged). */
  forget(factId: string) {
    return this.request<{ forgotten: string }>("DELETE", `/memories/${factId}`);
  }

  // --- Notes and graph ------------------------------------------------------------------------

  notes(q?: string) {
    return this.request<{ notes: NoteSummary[] }>("GET", `/notes${qs({ q })}`);
  }

  note(id: string) {
    return this.request<{ note: Note; markdown: string }>("GET", `/notes/${id}`);
  }

  editNote(id: string, patch: NotePatch) {
    return this.request<{ note: Omit<Note, "facts" | "backlinks"> }>("PATCH", `/notes/${id}`, patch);
  }

  /** `id` and `into` are the same thing: move everything into `into`. */
  mergeNote(id: string, into: string) {
    return this.request<{ merged: string; into: string }>("POST", `/notes/${id}/merge`, { into });
  }

  neighbours(id: string, hops = 2) {
    return this.request<{ graph: Graph; chain: string }>("GET", `/notes/${id}/neighbours${qs({ hops })}`);
  }

  timeline(entityId: string) {
    return this.request<{ timeline: TimelineEntry[] }>("GET", `/entities/${entityId}/timeline`);
  }

  /** Whole graph, or as it was at `at` (ISO date). */
  graph(at?: string) {
    return this.request<Graph>("GET", `/graph${qs({ at })}`);
  }

  // --- Review, sources, workspace ---------------------------------------------------------------

  review() {
    return this.request<{ contradictions: Contradiction[] }>("GET", "/review");
  }

  resolve(id: string, action: "accept" | "reject" | "keep_both") {
    return this.request<{ resolved: string; action: string }>("POST", `/review/${id}`, { action });
  }

  sources(opts: { q?: string; limit?: number } = {}) {
    return this.request<{ sources: SourceSummary[] }>("GET", `/sources${qs(opts)}`);
  }

  source(id: string) {
    return this.request<{ source: Source & { metadata: Record<string, unknown>; externalId: string | null }; facts: { id: string; statement: string; status: string; validFrom: string; validTo: string | null; extractorVersion: string; subjectId: string }[] }>("GET", `/sources/${id}`);
  }

  stats() {
    return this.request<Stats>("GET", "/stats");
  }

  status() {
    return this.request<Status>("GET", "/status");
  }

  usage(days = 30) {
    return this.request<Usage>("GET", `/usage${qs({ days })}`);
  }

  audit() {
    return this.request<{ audit: AuditEntry[] }>("GET", "/audit");
  }

  mergeDuplicates(dryRun = true) {
    return this.request<{ dryRun: boolean; pairs: DuplicatePair[] }>("POST", "/maintenance/merge-duplicates", { dryRun });
  }

  reextract(dryRun = true) {
    return this.request<{ dryRun: boolean; sources?: { sourceId: string; facts: number; versions: string[] }[]; queued?: number }>(
      "POST", "/maintenance/reextract", { dryRun },
    );
  }

  /** The Obsidian vault as a .zip. */
  async exportObsidian(): Promise<ArrayBuffer> {
    return (await this.fetch("/export/obsidian")).arrayBuffer();
  }

  /** Live updates (server-sent events). Returns the raw streaming Response. */
  events(signal?: AbortSignal): Promise<Response> {
    return this.fetch("/events", { signal, headers: { accept: "text/event-stream" } });
  }
}
