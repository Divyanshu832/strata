// Step 2 of the write path: one cheap LLM call turns a raw message into entities and facts.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";

export const Extraction = z.object({
  entities: z.array(
    z.object({
      name: z.string().describe("Canonical name, e.g. 'Harshit Makraria'"),
      type: z.enum(["person", "org", "project", "place", "topic", "thing"]),
      aliases: z.array(z.string()).describe("Other names used for it in the text"),
    }),
  ),
  facts: z.array(
    z.object({
      subject: z.string().describe("Entity name the fact is about ('user' for the speaker)"),
      predicate: z.string().describe("snake_case relation, e.g. lives_in, works_on, prefers"),
      object_entity: z.string().nullable().describe("Entity name if the object is a person/org/project/place/topic"),
      object_value: z.string().nullable().describe("Plain value if the object is not an entity"),
      statement: z.string().describe("The fact as one short sentence"),
      kind: z.enum(["fact", "preference", "event"]),
      exclusive: z.boolean().describe("True if the subject can only have one value for this predicate at a time (lives_in, age, job_title)"),
      valid_from: z.string().nullable().describe("ISO date when this became true or happened, if stated or implied"),
      context: z.string().nullable().describe("For preferences: where it applies, e.g. 'chat', 'code'"),
      strength: z.number().nullable().describe("For preferences: 0..1"),
    }),
  ),
});
export type Extraction = z.infer<typeof Extraction>;
export type ExtractedFact = Extraction["facts"][number];

const SYSTEM = `You extract long-term memory from conversations for an AI agent's memory store.
Extract only durable information worth remembering later: facts about people, projects, places and
organisations; the user's preferences; and notable events (decisions, plans, things that happened).
Skip small talk, questions, and anything only relevant to the current turn.
Use 'user' as the subject for facts about the speaker. Resolve relative dates ("yesterday", "last
March") against the message time given. If nothing is worth remembering, return empty lists.`;

let client: Anthropic | undefined;
const anthropic = () => (client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }));

export async function extract(input: {
  content: string;
  author?: string | null;
  occurredAt: Date;
}): Promise<Extraction> {
  const response = await anthropic().messages.parse({
    model: config.EXTRACT_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: zodOutputFormat(Extraction) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Message time: ${input.occurredAt.toISOString()}\nAuthor: ${input.author ?? "user"}\n\n${input.content}`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { entities: [], facts: [] };
  }
  return response.parsed_output;
}
