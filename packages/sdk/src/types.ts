// Response shapes of the Strata API (mirrors packages/server). Kept small and hand-written.

export type QueryType = "count" | "temporal" | "episodic" | "lookup" | "open";
export type Channel = "vector" | "text" | "graph" | "sql";
export type FactStatus = "active" | "replaced" | "contradiction" | "merged";
export type EntityType = "person" | "org" | "project" | "place" | "topic" | "thing";

/** A fact your agent extracted. Saved right away; Strata needs no LLM for it. */
export type AgentFact = {
  subject: string; // 'user' for the person the agent is helping
  predicate: string; // snake_case: lives_in, works_on, prefers, decided
  object: string;
  objectType?: "entity" | "value"; // default 'entity' (gets its own note)
  statement?: string;
  kind?: "fact" | "preference" | "event";
  exclusive?: boolean; // only one value at a time (a new one replaces the old)
  validFrom?: string; // ISO date
  context?: string;
  strength?: number;
};

export type EntityHint = { name: string; type?: EntityType; aliases?: string[] };

/** Send `facts` (extracted by your agent), raw `content`, or both. */
export type RememberInput = {
  content?: string;
  facts?: AgentFact[];
  entities?: EntityHint[];
  kind?: "message" | "session" | "document";
  scope?: string;
  author?: string;
  externalId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export type ApplyResult = { added: number; skipped: number; updated: number; history: number; contradictions: number };

export type RememberResult = {
  sources: { id: string; duplicate: boolean; mode: "facts" | "queued" | "duplicate"; result?: ApplyResult }[];
};

export type RecallInput = {
  query: string;
  maxTokens?: number;
  scopes?: string[];
  hops?: number;
  explain?: boolean;
  /** Memory as it stood at this date (ISO). */
  asOf?: string;
  /** "Today" for relative dates (ISO). */
  now?: string;
};

export type RecallItem = {
  id: string;
  type: "fact" | "chunk";
  text: string;
  score: number;
  subject: string | null;
  subjectId: string | null;
  objectId: string | null;
  validFrom: string;
  validTo: string | null;
  status: string;
  source: { id: string; excerpt: string; occurredAt: string } | null;
  explain?: { channels: { channel: Channel; rank: number; score: number }[] };
};

export type RecallResult = {
  query: string;
  route: { type: QueryType; reason: string; asOf?: string; latest?: boolean; range?: { from?: string; to?: string } };
  answer?: { kind: "count" | "latest"; value: number | string | null; factIds: string[]; sql: string };
  chain: string;
  items: RecallItem[];
  tokens: number;
  budget: number;
  latencyMs: number;
  explain?: {
    entities: { id: string; name: string }[];
    dropped: { id: string; text: string; reason: string }[];
    channelCounts: Record<Channel, number>;
    reranked: boolean;
    chainGraph: Graph;
  };
};

export type AnswerResult = {
  answer: string;
  recall: RecallResult;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
};

export type NoteSummary = {
  id: string;
  name: string;
  type: string;
  tags: string[];
  aliases: string[];
  facts: number;
  links: number;
  updatedAt: string;
};

export type GraphNode = { id: string; name: string; type: string; degree: number };
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string;
  validFrom: string;
  validTo: string | null;
  status: FactStatus;
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type NoteFact = {
  id: string;
  predicate: string;
  statement: string;
  objectId: string | null;
  objectName: string | null;
  objectValue: string | null;
  validFrom: string;
  validTo: string | null;
  status: FactStatus;
  sourceId: string | null;
};

export type Note = {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  tags: string[];
  facts: NoteFact[];
  backlinks: { factId: string; fromId: string; fromName: string; predicate: string }[];
};

export type NotePatch = { name?: string; type?: EntityType; aliases?: string[]; tags?: string[]; summary?: string | null };

export type TimelineEntry = {
  id: string;
  statement: string;
  predicate: string;
  kind: string;
  validFrom: string;
  validTo: string | null;
  recordedAt: string;
  status: FactStatus;
  sourceId: string | null;
};

export type FactDetail = {
  fact: {
    id: string; statement: string; kind: string; predicate: string; subjectId: string; objectId: string | null;
    objectValue: string | null; validFrom: string; validTo: string | null; recordedAt: string; status: FactStatus;
    pinned: boolean; confidence: number; sourceId: string | null; extractorVersion: string; supersededBy: string | null;
  };
  source: Source | null;
  versions: { id: string; statement: string; validFrom: string; validTo: string | null; status: FactStatus }[];
};

export type FactPatch = { statement?: string; pinned?: boolean; validTo?: string | null; status?: "active" | "contradiction" };

export type Source = {
  id: string;
  kind: "message" | "session" | "document";
  scope: string;
  author: string | null;
  content: string;
  occurredAt: string;
  processedAt: string | null;
};

export type SourceSummary = Source & { facts: number };

export type Contradiction = {
  id: string;
  statement: string;
  validFrom: string;
  recordedAt: string;
  subjectId: string;
  subject: string;
  predicate: string;
  sourceId: string | null;
  sourceContent: string | null;
  conflictsWith: { id: string; statement: string; validFrom: string; sourceId: string | null; status: FactStatus }[];
};

export type Stats = {
  notes: number;
  currentFacts: number;
  historyFacts: number;
  links: number;
  contradictions: number;
  sources: number;
  chunks: number;
  recent: { id: string; statement: string; kind: string; status: FactStatus; recordedAt: string; subjectId: string; subject: string }[];
};

export type Status = {
  pendingSources: number;
  extractor: "none" | "openrouter";
  answer: boolean;
  reranker: string | null;
  embeddingModel: string;
};

export type UsageKind = "remember" | "recall" | "answer" | "extract";
export type Usage = {
  days: { day: string; kind: UsageKind; calls: number; tokens: number; inputTokens: number; outputTokens: number; costUsd: number; p50Ms: number; p95Ms: number }[];
  totals: { kind: UsageKind; calls: number; tokens: number; avgTokens: number; costUsd: number; p50Ms: number; p95Ms: number }[];
  routes: { route: string; calls: number; avgTokens: number }[];
};

export type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  at: string;
};

export type DuplicatePair = { keepId: string; keep: string; dupId: string; dup: string; similarity: number };
