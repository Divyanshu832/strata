# Strata

**Memory for your AI agents that can count, cite, and show its work.**

Strata is one memory shared by all your agents: Claude Code (MCP), your own apps (REST API / TypeScript
SDK) and automations. Your agent decides what is worth remembering and sends it as facts; Strata keeps
them current over time (a new fact replaces the old one, and the history is kept) and shows memory as
linked notes and a graph, like an Obsidian vault.

- **Your agent extracts, Strata remembers:** no LLM inside Strata by default. The agent you already use
  sends structured facts; Strata matches names, replaces old facts, flags conflicts and indexes them.
- **Time-aware facts:** every fact has a `valid_from` / `valid_to`. Ask "what was true in March".
- **Counts and dates from SQL:** "how many times…" and "when did I last…" are answered by Postgres, not
  by an LLM guessing.
- **Connected recall:** one call returns the linked facts around the people and projects you asked about,
  trimmed to a token budget.
- **Nothing lost:** the original text is kept; old facts are closed, never deleted. Only `forget`
  deletes, and it is logged.
- **Show its work:** `explain: true` says how each memory was found.
- **Notes + graph web app:** backlinks, local graph, and a time slider over the whole graph.

Runs locally and free: PostgreSQL + pgvector, and an embedding model that runs inside the server. An
optional built-in extractor (any model via [OpenRouter](https://openrouter.ai)) handles raw text that has
no agent behind it.

> Status: early. The API, MCP server and web app are being built.

## Run it locally

You need Node 22+, [pnpm](https://pnpm.io) and [Postgres.app](https://postgresapp.com) (includes pgvector).

```bash
createdb strata
cp .env.example .env          # set STRATA_ADMIN_TOKEN to any long random string
pnpm install
pnpm migrate
pnpm --filter @stratamem/server create-key "me"   # copy the key into .env as STRATA_API_KEY
pnpm dev                      # API on http://localhost:8787
pnpm dev:web                  # web app on http://localhost:3000
```

### Use it from Claude Code

```bash
claude mcp add strata -- pnpm --dir "$(pwd)/packages/mcp" start
```

Tools: `remember`, `recall`, `forget`, `timeline`, `open_note`, `neighbours`.

### Use it from code

```ts
import { Strata } from "@stratamem/sdk";

const strata = new Strata({ apiKey: process.env.STRATA_API_KEY! });

// Your agent extracted this fact; Strata saves it as-is.
await strata.remember({
  content: "I moved to Pune in May.",
  facts: [{ subject: "user", predicate: "lives_in", object: "Pune", exclusive: true, validFrom: "2026-05-01" }],
});

const memory = await strata.recall({ query: "Where do I live?", maxTokens: 1000 });
```

Raw text without `facts` is kept and indexed for search. With `EXTRACTOR=openrouter`, Strata's own
extractor turns it into facts in the background.

## Layout

| Path | What |
|---|---|
| `packages/server` | API (Hono), Postgres schema and migrations, write and read pipelines, background jobs |
| `packages/mcp` | MCP server for Claude Code and other agents |
| `packages/sdk` | TypeScript client |
| `packages/web` | Web app: notes, backlinks, graph view |
| `bench` | Benchmark runner (LongMemEval-S, corrected LoCoMo) |

## License

MIT
