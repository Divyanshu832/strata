// Optional step 4 of the read path. RERANKER=none (default) keeps the fused order.
import { config } from "../config.js";

export type Rerankable = { id: string; text: string; score: number };

export async function rerank<T extends Rerankable>(query: string, items: T[]): Promise<T[]> {
  if (config.RERANKER === "none" || items.length < 2) return items;

  const url = config.RERANKER === "cohere" ? "https://api.cohere.com/v2/rerank" : "https://api.voyageai.com/v1/rerank";
  const key = config.RERANKER === "cohere" ? config.COHERE_API_KEY : config.VOYAGE_API_KEY;
  const model = config.RERANKER === "cohere" ? "rerank-v3.5" : "rerank-2.5";

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, query, documents: items.map((i) => i.text) }),
  });
  if (!res.ok) return items; // reranking is an improvement, never a reason to fail a recall

  const body = (await res.json()) as { results?: { index: number; relevance_score: number }[]; data?: { index: number; relevance_score: number }[] };
  const results = body.results ?? body.data ?? [];
  return results
    .map((r) => {
      const item = items[r.index];
      return item ? { ...item, score: r.relevance_score } : undefined;
    })
    .filter((i): i is T => i !== undefined);
}
