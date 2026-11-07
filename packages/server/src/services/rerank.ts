// Optional step 4 of the read path. RERANKER=none (default, free) keeps the fused order.
// TODO: a local cross-encoder option so reranking also works offline.
import { config } from "../config.js";

export type Rerankable = { id: string; text: string; score: number };

export async function rerank<T extends Rerankable>(query: string, items: T[]): Promise<T[]> {
  if (config.RERANKER === "none" || items.length < 2) return items;

  const res = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: { authorization: `Bearer ${config.COHERE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "rerank-v3.5", query, documents: items.map((i) => i.text) }),
  });
  if (!res.ok) return items; // reranking is an improvement, never a reason to fail a recall

  const body = (await res.json()) as { results?: { index: number; relevance_score: number }[] };
  const results = body.results ?? [];
  return results
    .map((r) => {
      const item = items[r.index];
      return item ? { ...item, score: r.relevance_score } : undefined;
    })
    .filter((i): i is T => i !== undefined);
}
