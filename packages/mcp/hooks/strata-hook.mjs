#!/usr/bin/env node
// Strata hooks for coding agents: memory that works even when the model forgets to use it.
// Installed by `pnpm connect` (packages/mcp/hooks/connect.mjs). Usage: strata-hook.mjs <agent> <event>
//
//   agent: claude | codex | gemini | cursor
//   event: start   session starts → inject a memory brief (and start the API if it's down)
//          prompt  user sends a message → recall about it and inject the result; count prompts
//          reply   (cursor only) the agent finished a message → save the turn
//          stop    the agent stops → save the conversation; every N prompts, a save checkpoint
//          compact before compaction → save, and run a checkpoint at the next stop
//          end     session ends → save what's left
//
// Plain JavaScript on purpose: it runs on every message, so it must start fast and never need a build.
// Config (env, or the repo's .env): STRATA_URL, STRATA_API_KEY, STRATA_CHECKPOINT_EVERY (default 6),
// STRATA_HOOK_RECALL ("0" turns off per-message recall), STRATA_AUTOSTART ("0" never starts the API).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv(join(REPO, ".env"));

const URL_ = (process.env.STRATA_URL || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.STRATA_API_KEY || "";
const EVERY = Number(process.env.STRATA_CHECKPOINT_EVERY || 6);
const RECALL_ON = process.env.STRATA_HOOK_RECALL !== "0";
const HOME_DIR = join(homedir(), ".strata");
const STATE_DIR = join(HOME_DIR, "hooks");
const MAX_SOURCE_CHARS = 40_000;

const RULES = `How to use Strata (the user's long-term memory and handbook, shared across sessions and agents):
- Treat it as the source of truth about the user, their work, people and past decisions. When a task touches
  any of those, use what was recalled, and call \`recall\` for more before acting.
- Save with \`remember\` as soon as something lasting comes up: every decision (big or small, with the reason),
  facts about people, companies, projects and tools, the user's preferences and rules, and their corrections.
- Full proper names; subject "user" for the user; named things as entity objects, descriptions as values; validFrom only when known.
- Never save secrets or other people's sensitive data. Checkpoints will also ask you to save.`;

const CHECKPOINT = `Strata checkpoint: before you stop, save to Strata (the user's long-term memory) everything lasting from the conversation since the last checkpoint. Call \`remember\` once, batching all facts:
- Every decision, big or small (what was chosen, and why if it was said), as kind "event" with predicate "decided".
- Facts about people, companies, projects, tools and how they relate; preferences and working rules the user stated; corrections the user made to you; what was built, changed or shipped.
- Full proper names ("Acme Corp", not "the company"); subject "user" for the user. Named people, companies, projects and tools go as entity objects ("user · reports_to · Dana Lee"); descriptions, decisions and preferences go as objectType "value". Pass validFrom only when you know it.
- Skip secrets, small talk and anything only true for this one task.
If there is truly nothing new, don't call it. Then end with one short line saying what you saved.`;

let wrote = false;
const [agent = "claude", event = ""] = process.argv.slice(2);
const input = readStdin();
const session = String(input.session_id || input.conversation_id || "default").replace(/[^\w.-]/g, "");
const cwd = input.cwd || input.workspace_roots?.[0] || process.cwd();

try {
  if (KEY) {
    if (event === "start") await start();
    else if (event === "prompt") await prompt();
    else if (event === "reply") await reply();
    else if (event === "stop") await stop();
    else if (event === "compact") await saveConversation(true);
    else if (event === "end") await saveConversation();
  }
} catch (err) {
  log(`${agent} ${event}: ${err?.message ?? err}`);
}
// Codex and Gemini expect JSON from some events; an empty object means "carry on".
if (!wrote) process.stdout.write(event === "prompt" && agent === "cursor" ? '{"continue":true}' : "{}");
process.exit(0); // a hook must never break the session

// ---------- events ----------

async function start() {
  if (!(await healthy())) await autostart();
  const project = basename(cwd);
  const [you, here, recent] = await Promise.all([
    recall("Who is the user: their role, work, people they work with, preferences and rules", 700),
    recall(`${project}: what it is, decisions, people involved, current state`, 700),
    call("GET", "/v1/memories?limit=15"),
  ]);
  if (!you && !here && !recent) {
    return context("start", `Strata (long-term memory) is not reachable at ${URL_}. Start it with \`pnpm dev\` in the Strata repo.`);
  }
  const latest = (recent?.facts ?? [])
    .filter((f) => f.status === "active")
    .slice(0, 12)
    .map((f) => `- ${f.statement}`)
    .join("\n");
  context(
    "start",
    [
      "## Strata memory brief",
      RULES,
      section("About the user", you),
      section(`About ${project}`, here),
      latest ? `### Most recent memories\n${latest}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

async function prompt() {
  // Harness-generated turns (background-task notices, subagent hand-backs) are not the user speaking:
  // don't count them toward a checkpoint, recall on them, or let them replace the user's pending message.
  if (/^\s*<(task-notification|agent-message)[\s>]/.test(String(input.prompt ?? ""))) return;
  const st = state();
  st.prompts = (st.prompts ?? 0) + 1;
  st.pending = String(input.prompt ?? "").slice(0, 20_000);
  save(st);
  if (agent === "cursor") return; // Cursor can't add context to a prompt
  const q = st.pending.trim();
  if (!RECALL_ON || q.length < 12 || q.startsWith("/")) return;
  const body = format(await recall(q.slice(0, 1000), 500));
  if (body) context("prompt", `Strata recalled this for the message (use it if relevant; recall again for more):\n${body}`);
}

async function reply() {
  await saveTurn(String(input.text ?? ""));
}

async function stop() {
  if (agent === "claude") await saveConversation();
  else if (agent === "codex") await saveTurn(input.last_assistant_message);
  else if (agent === "gemini") await saveTurn(input.prompt_response, input.prompt);
  // cursor: the turn was saved by `reply`

  const st = state();
  const continued = agent === "cursor" ? (input.loop_count ?? 0) > 0 : !!input.stop_hook_active;
  if (continued || input.status === "aborted" || input.status === "error") {
    if (continued) st.prompts = 0;
    return save(st);
  }
  if (st.forceCheckpoint || (st.prompts ?? 0) >= EVERY) {
    st.forceCheckpoint = false;
    st.prompts = 0;
    save(st);
    if (agent === "cursor") out({ followup_message: CHECKPOINT });
    else if (agent === "gemini") out({ decision: "deny", reason: CHECKPOINT });
    else out({ decision: "block", reason: CHECKPOINT });
  }
}

// ---------- saving the conversation ----------

/** One user message + the agent's answer, for agents whose transcript format isn't stable. */
async function saveTurn(answer, question) {
  const st = state();
  const q = String(question ?? st.pending ?? "").trim();
  const a = String(answer ?? "").trim();
  if (!q && !a) return;
  st.turn = (st.turn ?? 0) + 1;
  st.pending = "";
  const text = [q && `User: ${q}`, a && `Assistant: ${a}`].filter(Boolean).join("\n\n");
  const ok = await post(text, `${agent}:${session}:t${st.turn}`, new Date().toISOString());
  if (ok) save(st);
}

/** Claude Code: read the transcript from where we left off (also used for compact/end on every agent). */
async function saveConversation(compacting = false) {
  const st = state();
  if (compacting) {
    st.forceCheckpoint = true;
    save(st);
  }
  if (agent !== "claude") return; // other agents save turn by turn
  const path = input.transcript_path;
  if (!path || !existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  const from = st.line ?? 0;
  const turns = [];
  for (let i = from; i < lines.length; i++) {
    const t = claudeTurn(lines[i]);
    if (t) turns.push(t);
  }
  // Long stretches go up as several sources, never truncated.
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
    const ok = await post(b.map((t) => t.text).join("\n\n"), `claude-code:${session}:${from}${n ? `:${n}` : ""}`, b[0].at, [from, lines.length]);
    if (!ok) return; // retry the whole stretch next time; externalIds make it idempotent
  }
  st.line = lines.length;
  save(st);
}

/** One Claude Code transcript line → "User: …" / "Claude: …", or null for tool output and injected context. */
function claudeTurn(line) {
  if (!line) return null;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    return null;
  }
  if ((d.type !== "user" && d.type !== "assistant") || d.isMeta || d.isCompactSummary || d.isSidechain) return null;
  const c = d.message?.content;
  const parts = [];
  if (typeof c === "string") parts.push(c);
  else if (Array.isArray(c))
    for (const b of c) {
      if (b.type === "text") parts.push(b.text);
      else if (b.type === "tool_use") parts.push(`[${b.name}: ${toolNote(b.input)}]`);
    }
  const text = parts
    .map((s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim())
    .filter((s) => s && !/^<(command-|local-command|task-notification)/.test(s))
    .join("\n");
  return text ? { at: d.timestamp, text: `${d.type === "user" ? "User" : "Claude"}: ${text}` } : null;
}

function toolNote(i = {}) {
  const s = i.description || i.file_path || i.command || i.query || i.url || i.prompt || i.pattern || "";
  return String(s).replace(/\s+/g, " ").slice(0, 120);
}

async function post(text, externalId, occurredAt, lines) {
  return call("POST", "/v1/memories", {
    content: redact(text).slice(0, MAX_SOURCE_CHARS * 2),
    kind: "session",
    author: agent === "claude" ? "claude-code" : agent,
    externalId,
    occurredAt,
    metadata: { source: agent, session, project: basename(cwd), cwd, ...(lines ? { lines } : {}) },
  });
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

// ---------- output ----------

function out(obj) {
  wrote = true;
  process.stdout.write(JSON.stringify(obj));
}

/** Add text to the agent's context, in each agent's own format. */
function context(kind, text) {
  if (agent === "cursor") return kind === "start" ? out({ additional_context: text }) : undefined;
  const name = {
    claude: { start: "SessionStart", prompt: "UserPromptSubmit" },
    codex: { start: "SessionStart", prompt: "UserPromptSubmit" },
    gemini: { start: "SessionStart", prompt: "BeforeAgent" },
  }[agent]?.[kind];
  if (name) out({ hookSpecificOutput: { hookEventName: name, additionalContext: text } });
}

// ---------- Strata API ----------

function recall(query, maxTokens) {
  return call("POST", "/v1/recall", { query, maxTokens });
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

/** Start the local API in the background if it isn't running (it keeps running for later sessions). */
async function autostart() {
  if (process.env.STRATA_AUTOSTART === "0" || !/localhost|127\.0\.0\.1/.test(URL_)) return;
  const server = join(REPO, "packages/server");
  const tsx = join(server, "node_modules/tsx/dist/cli.mjs");
  if (!existsSync(tsx)) return;
  mkdirSync(HOME_DIR, { recursive: true });
  const logFd = openSync(join(HOME_DIR, "api.log"), "a");
  spawn(process.execPath, [tsx, "--env-file-if-exists=../../.env", "src/index.ts"], {
    cwd: server,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  }).unref();
  for (let i = 0; i < 24 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 500));
}

async function call(method, path, body) {
  try {
    const res = await fetch(URL_ + path, {
      method,
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log(`${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    log(`${method} ${path}: ${err?.message ?? err}`);
    return null;
  }
}

// ---------- plumbing ----------

function state() {
  for (const path of [statePath(), join(HOME_DIR, "claude-hooks", `${session}.json`)]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")); // the second path is where the first Claude-only version kept it
    } catch {}
  }
  return {};
}

function save(st) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...st, at: new Date().toISOString() }));
}

function statePath() {
  return join(STATE_DIR, `${agent}-${session}.json`);
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
    mkdirSync(HOME_DIR, { recursive: true });
    writeFileSync(join(HOME_DIR, "hooks.log"), `${new Date().toISOString()} ${msg}\n`, { flag: "a" });
  } catch {}
}
