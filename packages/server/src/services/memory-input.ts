// The one format facts arrive in. Your agent (Claude Code, an n8n AI node, any MCP client) sends this
// directly with `remember`. The optional Strata extractor produces the same format from raw text.
import { z } from "zod";

export const AgentFact = z.object({
  subject: z.string().describe("Who or what the fact is about. Use 'user' for the person you are helping."),
  predicate: z.string().describe("snake_case relation, e.g. lives_in, works_on, prefers, decided, visited"),
  object: z.string().describe("The other side: an entity name ('Pune', 'Strata', 'Harshit') or a plain value ('dark mode')"),
  objectType: z
    .enum(["entity", "value"])
    .default("entity")
    .describe("'entity' if the object is a person/org/project/place/topic worth its own note; 'value' otherwise"),
  statement: z.string().optional().describe("The fact as one short sentence; built from the parts if left out"),
  kind: z.enum(["fact", "preference", "event"]).default("fact"),
  exclusive: z
    .boolean()
    .default(false)
    .describe("True if the subject can only have one value at a time (lives_in, job_title, age): a new value replaces the old"),
  validFrom: z.string().optional().describe("ISO date when this became true or happened; defaults to the message time"),
  context: z.string().optional().describe("For preferences: where it applies, e.g. 'chat', 'code'"),
  strength: z.number().min(0).max(1).optional().describe("For preferences: 0..1"),
});
export type AgentFact = z.output<typeof AgentFact>;

export const EntityHint = z.object({
  name: z.string(),
  type: z.enum(["person", "org", "project", "place", "topic", "thing"]).default("thing"),
  aliases: z.array(z.string()).default([]),
});
export type EntityHint = z.output<typeof EntityHint>;

export const MemoryPayload = z.object({
  facts: z.array(AgentFact).default([]),
  entities: z.array(EntityHint).default([]),
});
export type MemoryPayload = z.output<typeof MemoryPayload>;

export const statementOf = (f: AgentFact) => f.statement ?? `${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`;
