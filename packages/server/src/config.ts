import { z } from "zod";

// Defaults are local and free: Postgres on this machine, embeddings inside the server, no LLM.
// Your agent (Claude Code, any MCP client) sends facts already extracted. The Strata extractor
// (OpenRouter) is optional, for raw text with no agent behind it.
const Env = z.object({
  DATABASE_URL: z.string().default("postgres://localhost:5432/strata"),
  PORT: z.coerce.number().default(8787),
  STRATA_ADMIN_TOKEN: z.string().optional(),

  // Optional Strata extractor for raw text: none (default) | openrouter
  EXTRACTOR: z.enum(["none", "openrouter"]).default("none"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_URL: z.string().default("https://openrouter.ai/api/v1"),
  EXTRACTOR_MODEL: z.string().default("z-ai/glm-5.3"),
  ANSWER_MODEL: z.string().default("z-ai/glm-5.3"),

  // Local embedding model (transformers.js). Size must match the migration (384).
  EMBEDDING_MODEL: z.string().default("Xenova/bge-small-en-v1.5"),
  EMBEDDING_DIM: z.coerce.number().default(384),
});

export type Config = z.infer<typeof Env>;

/** Parsed once at startup; throws with a readable message if something is wrong. */
export const config: Config = Env.parse(process.env);
