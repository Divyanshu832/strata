// Optional step 4 of the read path: rerank the fused results.
// TODO(W3): local cross-encoder via transformers.js (e.g. Xenova/ms-marco-MiniLM-L-6-v2), free and
// offline like the embeddings. Until then this keeps the fused order.

export type Rerankable = { id: string; text: string; score: number };

export async function rerank<T extends Rerankable>(_query: string, items: T[]): Promise<T[]> {
  return items;
}
