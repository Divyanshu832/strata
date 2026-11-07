# Strata

**Memory for your AI agents that can count, cite, and show its work.**

Repo: [github.com/Divyanshu832/strata](https://github.com/Divyanshu832/strata)

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
- **Show its work:** `explain: true` says how each memory was found (meaning, words, a link, or SQL),
  and what the token budget cut.
- **Conflicts are asked, not guessed:** two values for the same time are both kept and flagged for review.
- **Notes + graph web app:** one note per person/project/place, `[[links]]`, backlinks, a local graph,
  the whole memory as a graph with a time slider, a recall inspector, review, usage, and export to an
  Obsidian vault. New memories appear live as agents write them.

Runs locally and free: PostgreSQL + pgvector, and an embedding model that runs inside the server. An
optional built-in extractor (any model via [OpenRouter](https://openrouter.ai)) handles raw text that has
no agent behind it.

## Run it locally

You need Node 22+, [pnpm](https://pnpm.io) and [Postgres.app](https://postgresapp.com) (includes pgvector).

```bash
git clone https://github.com/Divyanshu832/strata.git && cd strata
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

Tools: `remember`, `recall`, `forget`, `find_note`, `open_note`, `timeline`, `neighbours`. The server also
tells Claude when to use them (recall before tasks that depend on you, remember durable facts).

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

### Options (`.env`)

| Variable | Default | What |
|---|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/strata` | Postgres with pgvector |
| `EXTRACTOR` | `none` | `openrouter` to extract facts from raw text on the server |
| `OPENROUTER_API_KEY` | | needed for `EXTRACTOR=openrouter` and `POST /v1/answer` |
| `RERANKER` | `none` | `local` adds a small cross-encoder (runs on this machine) |
| `EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | downloaded once to `~/.cache/strata/models` |

## Tests

```bash
pnpm test     # unit tests, plus end-to-end API tests when the database is reachable
```

## Benchmarks

`bench/run.py` runs LongMemEval-S and a corrected LoCoMo against Strata, no memory, full context and
Hindsight, with two answer models, and reports accuracy, tokens per answer, latency and $ per correct
answer. See the docstring at the top of the file.

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
