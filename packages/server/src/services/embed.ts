// Embeddings for facts, entities and chunks. Provider is configurable (OpenAI or Voyage).
import OpenAI from "openai";
import { config } from "../config.js";

let openai: OpenAI | undefined;

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (config.EMBEDDINGS_PROVIDER === "voyage") return embedVoyage(texts);

  openai ??= new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const res = await openai.embeddings.create({
    model: config.EMBEDDING_MODEL,
    input: texts,
    dimensions: config.EMBEDDING_DIM,
  });
  return res.data.map((d) => d.embedding);
}

async function embedVoyage(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${config.VOYAGE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: texts, output_dimension: config.EMBEDDING_DIM }),
  });
  if (!res.ok) throw new Error(`voyage embeddings failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  return body.data.map((d) => d.embedding);
}

/** pgvector literal, e.g. '[0.1,0.2]'. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
