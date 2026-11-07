// POST /v1/answer: answer a question straight from memory (used by benchmarks and simple agents).
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { recall, type RecallInput, type RecallResult } from "./recall.js";

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

export type AnswerResult = {
  answer: string;
  recall: RecallResult;
  usage: { inputTokens: number; outputTokens: number };
};

/** Formats the recalled memory as the context block given to the answering model. */
export function memoryContext(r: RecallResult): string {
  const parts: string[] = [];
  if (r.answer) {
    parts.push(`Database result (${r.answer.kind}): ${r.answer.value ?? "no match"} — counted from ${r.answer.factIds.length} fact(s).`);
  }
  if (r.chain) parts.push(`Connected facts:\n${r.chain}`);
  if (r.items.length) parts.push(`Relevant memories:\n${r.items.map((i) => `- ${i.text}`).join("\n")}`);
  return parts.join("\n\n") || "No relevant memories.";
}

export async function answer(
  workspaceId: string,
  input: RecallInput & { model?: string },
): Promise<AnswerResult> {
  const r = await recall(workspaceId, input);
  const response = await anthropic().messages.create({
    model: input.model ?? config.EXTRACT_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system:
      "Answer the question using only the memory below. If a database result is given, trust its count or date. " +
      "If the memory does not contain the answer, say you don't know. Be brief.",
    messages: [{ role: "user", content: `Memory:\n${memoryContext(r)}\n\nQuestion: ${input.query}` }],
  });
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  return {
    answer: response.stop_reason === "refusal" ? "I can't answer that." : text,
    recall: r,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
