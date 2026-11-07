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

server.registerTool(
  "remember",
  {
    description: "Save something worth remembering (a message, decision, preference or fact). Facts are extracted in the background.",
    inputSchema: { content: z.string(), scope: z.string().optional(), occurredAt: z.string().optional() },
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
