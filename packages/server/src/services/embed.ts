// Embeddings run inside the server (transformers.js, ONNX). Free, offline after the first model download,
// no service to install. Default model: bge-small-en-v1.5 (384 numbers per text).
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { config } from "../config.js";

// Keep downloaded models outside node_modules so reinstalls don't download them again.
env.cacheDir = config.MODEL_CACHE_DIR;

// bge models expect this prefix on search queries (not on stored text).
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractor: Promise<FeatureExtractionPipeline> | undefined;
const model = () =>
  (extractor ??= pipeline("feature-extraction", config.EMBEDDING_MODEL, { dtype: "q8" }).catch((err) => {
    extractor = undefined; // a failed download is retried on the next call
    throw err;
  }));

/** Embed stored text (facts, chunks). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out = await (await model())(texts, { pooling: "cls", normalize: true });
  return out.tolist() as number[][];
}

/** Embed a search query. */
export async function embedQuery(query: string): Promise<number[]> {
  const [v] = await embed([QUERY_PREFIX + query]);
  return v!;
}

/** pgvector literal, e.g. '[0.1,0.2]'. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
