#!/usr/bin/env node
// Claude Code hooks that make Strata the agent's memory without relying on the model to remember to use it.
//
//   session-start  Inject a memory brief (who the user is, this project, recent decisions) into the session.
//   prompt         Recall what Strata knows about the user's message and inject it; count prompts.
//   stop           Save the new part of the conversation as raw text (searchable, nothing lost). Every N
//                  prompts, block the stop once and ask the agent to save decisions and facts as structured
//                  facts with `remember`.
//   pre-compact    Save the conversation before it is compacted, and ask for a checkpoint after.
//   session-end    Save whatever is left.
//
// Plain JavaScript on purpose: it runs on every prompt, so it must start fast (no build, no tsx).
// Config (env, or the repo's .env): STRATA_URL, STRATA_API_KEY, STRATA_CHECKPOINT_EVERY (default 6),
// STRATA_HOOK_RECALL (default on; "0" turns off per-prompt recall).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, "../../../.env"));

const URL_ = (process.env.STRATA_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.STRATA_API_KEY || "";
const EVERY = Number(process.env.STRATA_CHECKPOINT_EVERY || 6);
const RECALL_ON = process.env.STRATA_HOOK_RECALL !== "0";
const STATE_DIR = join(homedir(), ".strata", "claude-hooks");
const MAX_SOURCE_CHARS = 40_000;

const CHECKPOINT = `Strata checkpoint: before stopping, save to Strata (the user's long-term memory and handbook) everything lasting from the conversation since the last checkpoint. Call \`remember\` once, batching all facts:
- Every decision, big or small (what was chosen, and why if it was said), as kind "event" with predicate "decided".
- Facts about people, companies, projects, tools and how they relate; preferences and working rules the user stated; corrections the user made to you; what was built, changed or shipped.
- Use full proper names ("Bioceutica Milano", not "the company"); subject "user" for the user. Prefer entity objects ("user · reports_to · Andrea Rimmaudo") over long sentences. Pass validFrom only when you know it.
- Skip secrets, small talk and anything only true for this one task.
If there is truly nothing new, don't call it. Then end with one short line saying what you saved.`;

const cmd = process.argv[2];
const input = readStdin();

try {
  if (!KEY) process.exit(0); // not configured: never get in the way
  if (cmd === "session-start") await sessionStart();
  else if (cmd === "prompt") await prompt();
  else if (cmd === "stop") await stop();
  else if (cmd === "pre-compact") await capture(true);
  else if (cmd === "session-end") await capture();
} catch (err) {
  log(`${cmd}: ${err?.message ?? err}`);
}
process.exit(0); // hooks must never break the session

// ---------- hooks ----------

async function sessionStart() {
  // On startup the API may still be booting (another hook starts it): wait up to ~12 s.
  for (let i = 0; i < 24 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
  const project = basename(input.cwd || process.cwd());
  const [you, here_, recent] = await Promise.all([
    recall("Who is the user: their role, work, people they work with, preferences and rules", 700),
    recall(`${project}: what it is, decisions, people involved, current state`, 700),
    get("/v1/memories?limit=15"),
  ]);
  const decisions = (recent?.facts ?? [])
    .filter((f) => f.status === "active")
    .slice(0, 12)
    .map((f) => `- ${f.statement}`)
    .join("\n");
  const parts = [
    "## Strata memory brief",
    "Strata is the user's long-term memory and handbook, shared across sessions and agents. What it knows:",
    section("About the user", you),
    section(`About ${project}`, here_),
    decisions ? `### Most recent memories\n${decisions}` : "",
    "Use `recall` for anything else. Decisions and lasting facts are saved with `remember` (checkpoints will remind you).",
  ];
  emit("SessionStart", parts.filter(Boolean).join("\n\n"));
}

async function prompt() {
  const st = state();
  st.prompts = (st.prompts ?? 0) + 1;
  save(st);
  const q = String(input.prompt ?? "").trim();
  if (!RECALL_ON || q.length < 12 || q.startsWith("/")) return;
  const r = await recall(q.slice(0, 1000), 500);
  const body = format(r);
  if (body) emit("UserPromptSubmit", `Strata recalled this for the message (use it if relevant; recall again for more):\n${body}`);
}

async function stop() {
  await capture();
  const st = state();
  if (input.stop_hook_active) {
    st.prompts = 0; // the checkpoint ran
    save(st);
    return;
  }
  if (st.forceCheckpoint || (st.prompts ?? 0) >= EVERY) {
    st.forceCheckpoint = false;
    st.prompts = 0;
    save(st);
    process.stdout.write(JSON.stringify({ decision: "block", reason: CHECKPOINT }));
  }
}

/** Send the conversation since the last capture to Strata as raw text: chunked, embedded, searchable. */
async function capture(compacting = false) {
  const path = input.transcript_path;
  if (!path || !existsSync(path)) return;
  const st = state();
  const lines = readFileSync(path, "utf8").split("\n");
  const from = st.line ?? 0;
  const turns = [];
  for (let i = from; i < lines.length; i++) {
    const t = turnText(lines[i]);
    if (t) turns.push(t);
  }
  if (compacting) st.forceCheckpoint = true;
  if (!turns.length) {
    st.line = lines.length;
    return save(st);
  }
  // Long stretches (a backfill, a long task) go up as several sources, never truncated.
  const session = input.session_id || basename(path, ".jsonl");
  const batches = [];
  let cur = [];
  let size = 0;
  for (const t of turns) {
    if (size + t.text.length > MAX_SOURCE_CHARS && cur.length) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.text.length;
  }
  if (cur.length) batches.push(cur);
  for (const [n, b] of batches.entries()) {
    const ok = await post("/v1/memories", {
      content: redact(b.map((t) => t.text).join("\n\n")).slice(0, MAX_SOURCE_CHARS * 2),
      kind: "session",
      author: "claude-code",
      externalId: `claude-code:${session}:${from}${n ? `:${n}` : ""}`,
      occurredAt: b[0].at,
      metadata: { source: "claude-code", session, project: basename(input.cwd || ""), cwd: input.cwd, lines: [from, lines.length] },
    });
    if (!ok) return; // retry the whole stretch next time (externalIds make it idempotent)
  }
  st.line = lines.length;
  save(st);
}

// ---------- transcript ----------

/** One transcript line → "User: …" / "Claude: …" text, or null for tool output, meta and injected context. */
function turnText(line) {
  if (!line) return null;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if ((d.type !== "user" && d.type !== "assistant") || d.isMeta || d.isCompactSummary || d.isSidechain) return null;
  const c = d.message?.content;
  const out = [];
  if (typeof c === "string") out.push(c);
  else if (Array.isArray(c))
    for (const b of c) {
      if (b.type === "text") out.push(b.text);
      else if (b.type === "tool_use") out.push(`[${b.name}: ${toolNote(b.input)}]`);
    }
  const text = out
    .map((s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim())
    .filter((s) => s && !/^<(command-|local-command|task-notification)/.test(s))
    .join("\n");
  if (!text) return null;
  return { at: d.timestamp, text: `${d.type === "user" ? "User" : "Claude"}: ${text}` };
}

function toolNote(i = {}) {
  const s = i.description || i.file_path || i.command || i.query || i.url || i.prompt || i.pattern || "";
  return String(s).replace(/\s+/g, " ").slice(0, 120);
}

/** Keys and tokens never go into memory. */
function redact(s) {
  return s
    .replace(/\b(sk|rk|pk)[-_](live|test|or|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, "[secret]")
    .replace(/\bsk_strata_[A-Za-z0-9_-]+/g, "[secret]")
    .replace(/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}/g, "[secret]")
    .replace(/\b(sb_secret|sb_publishable|shpat|shpss|xox[abpr])[-_][A-Za-z0-9_-]{10,}/g, "[secret]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[secret]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[secret]")
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^\s"']{6,}/gi, "$1[secret]");
}

// ---------- Strata API ----------

async function recall(query, maxTokens) {
  return post("/v1/recall", { query, maxTokens });
}

function format(r) {
  if (!r) return "";
  const parts = [];
  if (r.answer?.value != null) parts.push(`Database result: ${r.answer.value}`);
  if (r.chain) parts.push(r.chain);
  const items = (r.items ?? []).map((i) => `- ${i.text}`).slice(0, 8);
  if (items.length) parts.push(items.join("\n"));
  return parts.join("\n").trim();
}

function section(title, r) {
  const body = format(r);
  return body ? `### ${title}\n${body}` : "";
}

async function healthy() {
  try {
    return (await fetch(URL_ + "/health", { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function post(path, body) {
  return call(path, { method: "POST", body: JSON.stringify(body) });
}

async function get(path) {
  return call(path, { method: "GET" });
}

async function call(path, init) {
  try {
    const res = await fetch(URL_ + path, {
      ...init,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log(`${init.method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`${init.method} ${path}: ${err?.message ?? err}`);
    return null;
  }
}

// ---------- plumbing ----------

function emit(event, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }));
}

function state() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function save(st) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...st, at: new Date().toISOString() }));
}

function statePath() {
  return join(STATE_DIR, `${String(input.session_id || "default").replace(/[^\w-]/g, "")}.json`);
}

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function log(msg) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, "errors.log"), `${new Date().toISOString()} ${msg}\n`, { flag: "a" });
  } catch {}
}
