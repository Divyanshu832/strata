// Embeddings for facts, entities and chunks. Default: Ollama (local). Optional: OpenAI.
import OpenAI from "openai";
import { config } from "../config.js";

let openai: OpenAI | undefined;

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (config.EMBEDDINGS_PROVIDER === "openai") {
    openai ??= new OpenAI({ apiKey: config.OPENAI_API_KEY });
    const res = await openai.embeddings.create({
      model: config.EMBEDDING_MODEL,
      input: texts,
      dimensions: config.EMBEDDING_DIM,
    });
    return res.data.map((d) => d.embedding);
  }

  const res = await fetch(`${config.OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`ollama embed failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings;
}

/** pgvector literal, e.g. '[0.1,0.2]'. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
