// Strata MCP server (stdio). Lets Claude Code and other MCP clients use Strata as their memory.
// Register in Claude Code:  claude mcp add strata -- pnpm --dir <repo>/packages/mcp start
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Strata } from "@stratamem/sdk";

const strata = new Strata({
  baseUrl: process.env.STRATA_URL,
  apiKey: process.env.STRATA_API_KEY ?? "",
});

const server = new McpServer({ name: "strata", version: "0.1.0" });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

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
  statement: z.string().optional().describe("The fact as one short sentence."),
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
      content: z.string().optional().describe("The original text the facts came from."),
      scope: z.string().optional().describe("e.g. 'user', or a project name to keep memories separate."),
    },
  },
  async (args) => text(await strata.remember(args)),
);

server.registerTool(
  "recall",
  {
    description:
      "Look up memory. Returns the connected facts around the people/projects in the question (already linked, " +
      "no need to open notes one by one), plus the most relevant memories, within a token budget.",
    inputSchema: { query: z.string(), maxTokens: z.number().optional(), explain: z.boolean().optional() },
  },
  async (args) => {
    const r = await strata.recall(args);
    const parts = [
      r.answer ? `Database result (${r.answer.kind}): ${r.answer.value ?? "no match"}` : "",
      r.chain ? `Connected facts:\n${r.chain}` : "",
      r.items.length ? `Memories:\n${r.items.map((i) => `- ${i.text}`).join("\n")}` : "",
    ].filter(Boolean);
    return text(parts.join("\n\n") || "Nothing relevant in memory.");
  },
);

server.registerTool(
  "forget",
  { description: "Permanently forget one fact by id (logged).", inputSchema: { id: z.string() } },
  async ({ id }) => text(await strata.forget(id)),
);

server.registerTool(
  "timeline",
  { description: "Everything known about an entity in time order.", inputSchema: { entityId: z.string() } },
  async ({ entityId }) => text(await strata.timeline(entityId)),
);

server.registerTool(
  "open_note",
  { description: "Read one full note (an entity's facts, history and backlinks) as markdown.", inputSchema: { id: z.string() } },
  async ({ id }) => text((await strata.note(id)).markdown),
);

server.registerTool(
  "neighbours",
  {
    description: "Expand further from a note: the connected facts up to `hops` links away.",
    inputSchema: { id: z.string(), hops: z.number().int().min(1).max(3).optional() },
  },
  async ({ id, hops }) => text((await strata.neighbours(id, hops)).chain),
);

await server.connect(new StdioServerTransport());
