// Optional step 4 of the read path: rerank the fused results with a small cross-encoder that runs
// in-process (transformers.js), free and offline like the embeddings. RERANKER=local turns it on.
// A cross-encoder reads the question and each memory together, so it judges relevance better than
// vector distance, at a few ms per item. Only the top RERANK_TOP items are rescored.
import { AutoModelForSequenceClassification, AutoTokenizer } from "@huggingface/transformers";
import { config } from "../config.js";
import "./embed.js"; // sets the shared model cache directory

const RERANK_TOP = 30;

export type Rerankable = { id: string; text: string; score: number };

type Loaded = { tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>; model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>> };
let loaded: Promise<Loaded> | undefined;
const load = () =>
  (loaded ??= Promise.all([
    AutoTokenizer.from_pretrained(config.RERANK_MODEL),
    AutoModelForSequenceClassification.from_pretrained(config.RERANK_MODEL, { dtype: "q8" }),
  ])
    .then(([tokenizer, model]) => ({ tokenizer, model }))
    .catch((err) => {
      loaded = undefined;
      throw err;
    }));

export const rerankEnabled = () => config.RERANKER === "local";

/** Relevance logits for (query, text) pairs. */
export async function crossScores(query: string, texts: string[]): Promise<number[]> {
  if (texts.length === 0) return [];
  const { tokenizer, model } = await load();
  const inputs = tokenizer(new Array(texts.length).fill(query), { text_pair: texts, padding: true, truncation: true });
  const { logits } = await model(inputs);
  return (logits.tolist() as number[][]).map((row) => row[0] ?? 0);
}

/**
 * Reorders the top items by cross-encoder relevance. Scores become 0..1 (sigmoid of the logit), so the
 * budget packer's threshold still means "relevant or not". Items past the top keep their order below.
 */
export async function rerank<T extends Rerankable>(query: string, items: T[]): Promise<T[]> {
  if (!rerankEnabled() || items.length < 2) return items;
  const head = items.slice(0, RERANK_TOP);
  const logits = await crossScores(query, head.map((i) => i.text));
  const rescored = head
    .map((item, i) => ({ ...item, score: item.score > 0 ? 1 / (1 + Math.exp(-(logits[i] ?? 0))) : 0 }))
    .sort((a, b) => b.score - a.score);
  return [...rescored, ...items.slice(RERANK_TOP).map((i) => ({ ...i, score: 0 }))];
}
