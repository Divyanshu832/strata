// Strata MCP server (stdio). Lets Claude Code and other MCP clients use Strata as their memory.
// Connect Claude Code, Codex, Gemini CLI and Cursor (tools + hooks + memory rule):  pnpm connect
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Strata, StrataError, type RecallResult } from "@stratamem/sdk";

const strata = new Strata({
  baseUrl: process.env.STRATA_URL,
  apiKey: process.env.STRATA_API_KEY ?? "",
});

const INSTRUCTIONS = `Strata is your long-term memory, shared with the user's other agents.
- At the start of a task that may depend on the user, their people, projects or past decisions, call recall.
- When you learn something durable (facts about people/projects/places, preferences, decisions, events),
  call remember with facts you extracted yourself. Save every decision, big or small, as kind "event" with
  predicate "decided". Skip small talk and one-off details.
- Use full proper names and subject "user" for the user. Prefer entity objects (user · reports_to · Andrea)
  over long sentences as values. Pass validFrom only when you know it; otherwise leave it out.
- Mark facts that can hold only one value at a time (lives_in, works_at, job_title) as exclusive: a new value
  replaces the old one and the old one is kept as history.
- Counts and dates ("how many times", "when did I last") are answered by the database: trust that value.
- Recall already follows links between notes; use neighbours/open_note only to dig further.`;

const server = new McpServer({ name: "strata", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

/** Tool errors go back to the agent as text instead of crashing the call. */
const safe =
  <A,>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
  async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      const msg = err instanceof StrataError ? `Strata error ${err.status}: ${err.message}` : `Strata unreachable: ${String(err)}`;
      return { ...text(msg), isError: true };
    }
  };

// You (the agent) do the extraction: read the conversation, keep only durable information, and send it
// as facts. Strata saves them without any LLM of its own.
const Fact = z.object({
  subject: z.string().describe("Who/what the fact is about. 'user' for the person you are helping."),
  predicate: z.string().describe("snake_case relation: lives_in, works_on, prefers, decided, visited, ..."),
  object: z.string().describe("Entity name ('Pune', 'Strata', 'Harshit') or a plain value ('dark mode')."),
  objectType: z.enum(["entity", "value"]).optional().describe("'entity' (default) if it deserves its own note; 'value' otherwise."),
  kind: z.enum(["fact", "preference", "event"]).optional(),
  exclusive: z.boolean().optional().describe("True if only one value can hold at a time (lives_in, job_title): a new value replaces the old."),
  validFrom: z.string().optional().describe("ISO date it became true / happened, if known."),
  statement: z.string().optional().describe("The fact as one short, self-contained sentence."),
  context: z.string().optional().describe("For preferences: where it applies ('code', 'chat')."),
});

const Entity = z.object({
  name: z.string(),
  type: z.enum(["person", "org", "project", "place", "topic", "thing"]).optional(),
  aliases: z.array(z.string()).optional(),
});

server.registerTool(
  "remember",
  {
    description:
      "Save durable information for later: facts about people, projects and places, the user's preferences, " +
      "decisions and events. Extract them yourself as facts (skip small talk and one-off details). " +
      "Include the original message as `content` when useful, so the source is kept.",
    inputSchema: {
      facts: z.array(Fact),
      entities: z.array(Entity).optional().describe("Types and aliases for the names used in facts."),
      content: z.string().optional().describe("The original text the facts came from."),
      scope: z.string().optional().describe("e.g. 'user', or a project name to keep memories separate."),
      occurredAt: z.string().optional().describe("ISO time the conversation happened; defaults to now."),
    },
  },
  safe(async (args) => {
    const r = await strata.remember(args);
    const s = r.sources[0];
    if (!s) return text("Nothing stored.");
    if (s.mode === "duplicate") return text("Already stored (same externalId).");
    if (!s.result) return text("Stored; the text will be indexed in the background.");
    const { added, updated, history, skipped, contradictions } = s.result;
    return text(
      `Saved: ${added} new, ${updated} replaced an older value, ${history} stored as history, ${skipped} already known` +
        (contradictions ? `, ${contradictions} conflicting (flagged for the user to review).` : "."),
    );
  }),
);

function formatRecall(r: RecallResult): string {
  const parts = [
    r.answer
      ? `Database result (${r.answer.kind === "count" ? "count" : "latest date"}): ${r.answer.value ?? "no match"} ` +
        `(from ${r.answer.factIds.length} matching fact(s); trust this over counting the list below)`
      : "",
    r.chain ? `Connected facts:\n${r.chain}` : "",
    r.items.length ? `Memories:\n${r.items.map((i) => `- ${i.text} [id ${i.id}]`).join("\n")}` : "",
  ].filter(Boolean);
  return parts.join("\n\n") || "Nothing relevant in memory.";
}

server.registerTool(
  "recall",
  {
    description:
      "Look up memory. Returns the connected facts around the people/projects in the question (already linked, " +
      "no need to open notes one by one), plus the most relevant memories, within a token budget. " +
      "Counts and 'when did I last' questions come back as a database result.",
    inputSchema: {
      query: z.string().describe("The question, in natural language."),
      maxTokens: z.number().int().min(100).optional().describe("Token budget for the result; a default per question type is used."),
      asOf: z.string().optional().describe("ISO date: answer as memory stood then."),
    },
  },
  safe(async (args) => text(formatRecall(await strata.recall(args)))),
);

server.registerTool(
  "forget",
  { description: "Permanently forget one fact by id (logged). Use only when the user asks.", inputSchema: { id: z.string() } },
  safe(async ({ id }) => text(await strata.forget(id))),
);

server.registerTool(
  "find_note",
  {
    description: "Find notes (people, projects, places, topics) by name or alias. Returns ids for open_note / timeline / neighbours.",
    inputSchema: { name: z.string() },
  },
  safe(async ({ name }) => {
    const { notes } = await strata.notes(name);
    return text(notes.slice(0, 10).map((n) => `${n.name} (${n.type}, ${n.facts} facts) id=${n.id}`).join("\n") || "No matching note.");
  }),
);

server.registerTool(
  "open_note",
  { description: "Read one full note (an entity's facts, history and backlinks) as markdown.", inputSchema: { id: z.string() } },
  safe(async ({ id }) => text((await strata.note(id)).markdown)),
);

server.registerTool(
  "timeline",
  { description: "Everything known about a note in time order, including replaced facts.", inputSchema: { id: z.string() } },
  safe(async ({ id }) => {
    const { timeline } = await strata.timeline(id);
    return text(
      timeline
        .map((t) => `${t.validFrom.slice(0, 10)}${t.validTo ? ` → ${t.validTo.slice(0, 10)}` : ""}  ${t.statement} (${t.status})`)
        .join("\n") || "No facts.",
    );
  }),
);

server.registerTool(
  "neighbours",
  {
    description: "Expand further from a note: the connected facts up to `hops` links away.",
    inputSchema: { id: z.string(), hops: z.number().int().min(1).max(3).optional() },
  },
  safe(async ({ id, hops }) => text((await strata.neighbours(id, hops)).chain || "No links.")),
);

await server.connect(new StdioServerTransport());
