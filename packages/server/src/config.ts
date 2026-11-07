import { z } from "zod";

// Everything defaults to local and free: Postgres on this machine, models through Ollama.
// Paid providers (Anthropic, OpenAI) are optional and only used if you switch to them here.
const Env = z.object({
  DATABASE_URL: z.string().default("postgres://localhost:5432/strata"),
  PORT: z.coerce.number().default(8787),
  STRATA_ADMIN_TOKEN: z.string().optional(),

  // LLM for extraction and answers: ollama (local, default) | anthropic
  LLM_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  EXTRACT_MODEL: z.string().default("qwen3:8b"),
  ANSWER_MODEL: z.string().default("qwen3:8b"),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Embeddings: ollama (local, default) | openai. The vector size must match the migration (768).
  EMBEDDINGS_PROVIDER: z.enum(["ollama", "openai"]).default("ollama"),
  EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  EMBEDDING_DIM: z.coerce.number().default(768),
  OPENAI_API_KEY: z.string().optional(),

  // Optional reranker (off by default)
  RERANKER: z.enum(["none", "cohere"]).default("none"),
  COHERE_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

/** Parsed once at startup; throws with a readable message if something is wrong. */
export const config: Config = Env.parse(process.env);

/** Bump when the extraction prompt or schema changes, so re-extraction can find old facts. */
export const EXTRACTOR_VERSION = "extract-v1";
