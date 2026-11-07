// Optional Strata extractor: turns raw text into the same MemoryPayload an agent would send.
// Only used when EXTRACTOR=openrouter (for sources with no agent behind them: imports, plain webhooks).
import { config } from "../config.js";
import { generateJson, type Usage } from "./llm.js";
import { MemoryPayload } from "./memory-input.js";

/** Bump when the prompt or schema changes, so re-extraction can find facts made by older versions. */
export const EXTRACTOR_VERSION = "strata-extract-v1";

const SYSTEM = `You extract long-term memory from conversations for an AI agent's memory store.
Extract only durable information worth remembering later: facts about people, projects, places and
organisations; the user's preferences; and notable events (decisions, plans, things that happened).
Skip small talk, questions, and anything only relevant to the current turn.
Use 'user' as the subject for facts about the speaker. Resolve relative dates ("yesterday", "last
March") against the message time given. If nothing is worth remembering, return empty lists.`;

export async function extract(input: {
  content: string;
  author?: string | null;
  occurredAt: Date;
}): Promise<{ payload: MemoryPayload; usage: Usage }> {
  const { data, usage } = await generateJson({
    model: config.EXTRACTOR_MODEL,
    system: SYSTEM,
    user: `Message time: ${input.occurredAt.toISOString()}\nAuthor: ${input.author ?? "user"}\n\n${input.content}`,
    schema: MemoryPayload,
  });
  return { payload: data ?? { facts: [], entities: [] }, usage };
}
