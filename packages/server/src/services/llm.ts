// One small interface over the two LLM providers: Ollama (local, default) and Anthropic (optional).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";

let anthropicClient: Anthropic | undefined;
const anthropic = () => (anthropicClient ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

export type Usage = { inputTokens: number; outputTokens: number };

/** Structured output: the model must return JSON matching `schema`. Returns null if it can't. */
export async function generateJson<T extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: T;
}): Promise<{ data: z.infer<T> | null; usage: Usage }> {
  if (config.LLM_PROVIDER === "anthropic") {
    const res = await anthropic().messages.parse({
      model: opts.model,
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(opts.schema) },
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    if (res.stop_reason === "refusal") return { data: null, usage };
    return { data: res.parsed_output ?? null, usage };
  }

  // Ollama: `format` takes a JSON schema and constrains the output to it.
  const body = await ollamaChat({
    model: opts.model,
    system: opts.system,
    user: opts.user,
    format: z.toJSONSchema(opts.schema),
  });
  const parsed = opts.schema.safeParse(safeJson(body.message.content));
  return { data: parsed.success ? parsed.data : null, usage: ollamaUsage(body) };
}

/** Plain text answer. */
export async function generateText(opts: { model: string; system: string; user: string }): Promise<{ text: string; usage: Usage }> {
  if (config.LLM_PROVIDER === "anthropic") {
    const res = await anthropic().messages.create({
      model: opts.model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return {
      text: res.stop_reason === "refusal" ? "I can't answer that." : text,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }
  const body = await ollamaChat({ model: opts.model, system: opts.system, user: opts.user });
  return { text: body.message.content.trim(), usage: ollamaUsage(body) };
}

type OllamaChatResponse = { message: { content: string }; prompt_eval_count?: number; eval_count?: number };

async function ollamaChat(opts: { model: string; system: string; user: string; format?: unknown }): Promise<OllamaChatResponse> {
  const res = await fetch(`${config.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      think: false,
      format: opts.format,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama chat failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as OllamaChatResponse;
}

const ollamaUsage = (b: OllamaChatResponse): Usage => ({ inputTokens: b.prompt_eval_count ?? 0, outputTokens: b.eval_count ?? 0 });

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
