// Response shapes of the Strata API (mirrors packages/server). Kept small and hand-written.

export type QueryType = "count" | "temporal" | "episodic" | "lookup" | "open";
export type Channel = "vector" | "text" | "graph" | "sql";

export type RememberInput = {
  content: string;
  kind?: "message" | "session" | "document";
  scope?: string;
  author?: string;
  externalId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
};

export type RecallInput = {
  query: string;
  maxTokens?: number;
  scopes?: string[];
  hops?: number;
  explain?: boolean;
};

export type RecallItem = {
  id: string;
  text: string;
  score: number;
  subject: string;
  validFrom: string;
  validTo: string | null;
  status: string;
  source: { id: string; excerpt: string; occurredAt: string } | null;
  explain?: { channels: { channel: Channel; rank: number; score: number }[] };
};

export type RecallResult = {
  query: string;
  route: { type: QueryType; reason: string };
  answer?: { kind: "count" | "latest"; value: number | string | null; factIds: string[] };
  chain: string;
  items: RecallItem[];
  tokens: number;
  budget: number;
  explain?: { entities: string[]; dropped: { id: string; reason: string }[]; channelCounts: Record<Channel, number> };
};

export type AnswerResult = {
  answer: string;
  recall: RecallResult;
  usage: { inputTokens: number; outputTokens: number };
};

export type NoteSummary = { id: string; name: string; type: string; tags: string[]; facts: number };

export type GraphNode = { id: string; name: string; type: string; degree: number };
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  predicate: string;
  validFrom: string;
  validTo: string | null;
  status: "active" | "replaced" | "contradiction";
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type Note = {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  tags: string[];
  facts: {
    id: string;
    predicate: string;
    statement: string;
    objectId: string | null;
    objectName: string | null;
    objectValue: string | null;
    validFrom: string;
    validTo: string | null;
    status: GraphEdge["status"];
    sourceId: string | null;
  }[];
  backlinks: { factId: string; fromId: string; fromName: string; predicate: string }[];
};
