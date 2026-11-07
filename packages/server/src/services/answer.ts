// POST /v1/answer: answer a question straight from memory. Optional (needs OPENROUTER_API_KEY);
// normally your agent reads /recall and writes the reply itself. Used by the benchmarks.
import { config } from "../config.js";
import { generateText, type Usage } from "./llm.js";
import { recall, type RecallInput, type RecallResult } from "./recall.js";

export type AnswerResult = {
  answer: string;
  recall: RecallResult;
  usage: Usage;
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
  const { text, usage } = await generateText({
    model: input.model ?? config.ANSWER_MODEL,
    system:
      "Answer the question using only the memory below. If a database result is given, trust its count or date. " +
      "If the memory does not contain the answer, say you don't know. Be brief.",
    user: `Memory:\n${memoryContext(r)}\n\nQuestion: ${input.query}`,
  });
  return { answer: text, recall: r, usage };
}
