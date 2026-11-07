// LLM calls, only for the optional Strata extractor and the /answer endpoint. OpenRouter (any model,
// GLM by default) through its OpenAI-compatible API. The core memory never needs this.
import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";

let client: OpenAI | undefined;
const openrouter = () => {
  if (!config.OPENROUTER_API_KEY) throw new LlmDisabledError();
  return (client ??= new OpenAI({ apiKey: config.OPENROUTER_API_KEY, baseURL: config.OPENROUTER_URL }));
};

export class LlmDisabledError extends Error {
  constructor() {
    super("No LLM configured. Set OPENROUTER_API_KEY to use the Strata extractor or /answer.");
  }
}

export const llmEnabled = () => Boolean(config.OPENROUTER_API_KEY);

export type Usage = { inputTokens: number; outputTokens: number; costUsd?: number };

// OpenRouter extras: keep reasoning short, and return the real cost of each call.
const extras = { reasoning: { effort: "low" }, usage: { include: true } };

function usageOf(res: OpenAI.Chat.Completions.ChatCompletion): Usage {
  const u = res.usage as (OpenAI.CompletionUsage & { cost?: number }) | undefined;
  return { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0, costUsd: u?.cost };
}

/** Structured output: JSON that must match `schema`. Returns null data if the model's output doesn't parse. */
export async function generateJson<T extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: T;
}): Promise<{ data: z.output<T> | null; usage: Usage }> {
  const res = await openrouter().chat.completions.create({
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "memory", strict: true, schema: z.toJSONSchema(opts.schema, { io: "input" }) as Record<string, unknown> },
    },
    ...extras,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
  const parsed = opts.schema.safeParse(safeJson(res.choices[0]?.message.content ?? ""));
  return { data: parsed.success ? parsed.data : null, usage: usageOf(res) };
}

export async function generateText(opts: { model: string; system: string; user: string }): Promise<{ text: string; usage: Usage }> {
  const res = await openrouter().chat.completions.create({
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    ...extras,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
  return { text: (res.choices[0]?.message.content ?? "").trim(), usage: usageOf(res) };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
