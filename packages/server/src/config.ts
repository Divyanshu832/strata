import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/strata"),
  PORT: z.coerce.number().default(8787),
  STRATA_ADMIN_TOKEN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACT_MODEL: z.string().default("claude-haiku-5-5"),
  RECONCILE_MODEL: z.string().default("claude-sonnet-5-5"),

  EMBEDDINGS_PROVIDER: z.enum(["openai", "voyage"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIM: z.coerce.number().default(1536),

  RERANKER: z.enum(["none", "voyage", "cohere"]).default("none"),
  COHERE_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

/** Parsed once at startup; throws with a readable message if something is wrong. */
export const config: Config = Env.parse(process.env);

/** Bump when the extraction prompt or schema changes, so re-extraction can find old facts. */
export const EXTRACTOR_VERSION = "extract-v1";
