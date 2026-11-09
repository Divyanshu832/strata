#!/usr/bin/env node
// Connect coding agents to Strata in one step: MCP tools + lifecycle hooks + a memory rule.
//
//   pnpm connect                    connect every agent found on this machine
//   pnpm connect claude codex       connect only these (claude | codex | gemini | cursor)
//   pnpm connect --remove [agents]  undo it
//   pnpm connect --dry-run          show what would change
//
// Every file is backed up once (<file>.strata-backup) before its first change. Re-running is safe: Strata's
// own entries are replaced, everything else in your config is kept.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOME = homedir();
const NODE = stableNode(); // the PATH shim survives Node upgrades; the resolved binary path doesn't
const HOOK = join(REPO, "packages/mcp/hooks/strata-hook.mjs");
const TSX = join(REPO, "packages/mcp/node_modules/tsx/dist/cli.mjs");
const MCP_ENTRY = join(REPO, "packages/mcp/src/index.ts");
const ENV_FILE = join(REPO, ".env");
const OURS = /packages\/mcp\/hooks\/(strata-hook|claude-code)\.mjs/; // also cleans up the older Claude-only hook

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const dry = args.includes("--dry-run");
const AGENTS = ["claude", "codex", "gemini", "cursor"];
const asked = args.filter((a) => AGENTS.includes(a));
const unknown = args.filter((a) => !a.startsWith("--") && !AGENTS.includes(a));
if (unknown.length) fail(`Unknown agent(s): ${unknown.join(", ")}. Use: ${AGENTS.join(", ")}`);

const RULE = `# Memory (Strata)

Strata is my long-term memory and handbook, shared across every session, project and agent. Treat it as
the source of truth about me, my work, my people and every decision we have made.

- Each session starts with a Strata memory brief, and messages may come with recalled memories. Use them.
  When a task touches people, companies, projects or past decisions, \`recall\` for more before acting.
- Save with \`remember\` as soon as something lasting comes up: every decision, big or small (what and why),
  facts about people, companies, projects and tools, my preferences and rules, and corrections I make.
  Batch several facts into one call. Checkpoints will also ask you to save; do it properly.
- Full proper names ("Acme Corp", not "the company"); subject "user" for me. Prefer entity objects
  ("user · reports_to · Dana Lee") over long sentences. Mark one-value facts (job_title, lives_in) exclusive.
  Pass validFrom only when you actually know it.
- Never save secrets (passwords, API keys, tokens) or other people's sensitive data.

The conversation itself is also saved to Strata automatically, so nothing is lost.`;

const hook = (agent, event) => `"${NODE}" "${HOOK}" ${agent} ${event}`;
const mcpServer = () => ({ command: NODE, args: [TSX, `--env-file-if-exists=${ENV_FILE}`, MCP_ENTRY] });

// ---------- agents ----------

const setups = {
  claude: {
    name: "Claude Code",
    found: () => existsSync(join(HOME, ".claude")) || onPath("claude"),
    mcp: (on) => {
      if (onPath("claude")) {
        run("claude", ["mcp", "remove", "-s", "user", "strata"], true);
        if (on) run("claude", ["mcp", "add", "-s", "user", "strata", "--", NODE, ...mcpServer().args]);
        return;
      }
      editJson(join(HOME, ".claude.json"), (c) => setMcp(c, "mcpServers", on && { type: "stdio", ...mcpServer(), env: {} }));
    },
    hooks: (on) =>
      editJson(join(HOME, ".claude/settings.json"), (c) =>
        setHooks(c, on && {
          SessionStart: [group(hook("claude", "start"), 30)],
          UserPromptSubmit: [group(hook("claude", "prompt"), 10)],
          Stop: [group(hook("claude", "stop"), 20)],
          PreCompact: [group(hook("claude", "compact"), 30)],
          SessionEnd: [group(hook("claude", "end"), 20)],
        }),
      ),
    rules: join(HOME, ".claude/CLAUDE.md"),
  },

  codex: {
    name: "Codex",
    found: () => existsSync(join(HOME, ".codex")) || onPath("codex"),
    mcp: (on) => {
      if (onPath("codex")) {
        run("codex", ["mcp", "remove", "strata"], true);
        if (on) run("codex", ["mcp", "add", "strata", "--", NODE, ...mcpServer().args]);
        return;
      }
      editText(join(HOME, ".codex/config.toml"), (t) => {
        t = t.replace(/\n?# strata:begin[\s\S]*?# strata:end\n?/g, "\n");
        if (!on) return t;
        const s = mcpServer();
        return `${t.trimEnd()}\n\n# strata:begin\n[mcp_servers.strata]\ncommand = ${JSON.stringify(s.command)}\nargs = ${JSON.stringify(s.args)}\n# strata:end\n`;
      });
    },
    hooks: (on) =>
      editJson(join(HOME, ".codex/hooks.json"), (c) =>
        setHooks(c, on && {
          SessionStart: [group(hook("codex", "start"), 30)],
          UserPromptSubmit: [group(hook("codex", "prompt"), 10)],
          Stop: [group(hook("codex", "stop"), 20)],
          PreCompact: [group(hook("codex", "compact"), 20)],
          SessionEnd: [group(hook("codex", "end"), 3)],
        }),
      ),
    rules: join(HOME, ".codex/AGENTS.md"),
    note: "Open Codex and run /hooks once to review and trust the Strata hooks (Codex skips untrusted hooks).",
  },

  gemini: {
    name: "Gemini CLI",
    found: () => existsSync(join(HOME, ".gemini")) || onPath("gemini"),
    mcp: (on) => editJson(join(HOME, ".gemini/settings.json"), (c) => setMcp(c, "mcpServers", on && mcpServer())),
    hooks: (on) =>
      editJson(join(HOME, ".gemini/settings.json"), (c) =>
        setHooks(c, on && {
          SessionStart: [group(hook("gemini", "start"), 30_000, "strata-start")],
          BeforeAgent: [group(hook("gemini", "prompt"), 10_000, "strata-recall")],
          AfterAgent: [group(hook("gemini", "stop"), 20_000, "strata-save")],
          PreCompress: [group(hook("gemini", "compact"), 20_000, "strata-compact")],
          SessionEnd: [group(hook("gemini", "end"), 10_000, "strata-end")],
        }),
      ),
    rules: join(HOME, ".gemini/GEMINI.md"),
    note: "If Gemini lists the hooks as disabled, run /hooks enable-all in Gemini CLI.",
  },

  cursor: {
    name: "Cursor",
    found: () => existsSync(join(HOME, ".cursor")),
    mcp: (on) => editJson(join(HOME, ".cursor/mcp.json"), (c) => setMcp(c, "mcpServers", on && mcpServer())),
    hooks: (on) =>
      editJson(join(HOME, ".cursor/hooks.json"), (c) => {
        c.version ??= 1;
        c.hooks ??= {};
        const ours = on && {
          sessionStart: [{ command: hook("cursor", "start"), timeout: 30 }],
          beforeSubmitPrompt: [{ command: hook("cursor", "prompt"), timeout: 10 }],
          afterAgentResponse: [{ command: hook("cursor", "reply"), timeout: 20 }],
          stop: [{ command: hook("cursor", "stop"), timeout: 20, loop_limit: 1 }],
          preCompact: [{ command: hook("cursor", "compact"), timeout: 20 }],
          sessionEnd: [{ command: hook("cursor", "end"), timeout: 20 }],
        };
        for (const [ev, list] of Object.entries(c.hooks)) {
          c.hooks[ev] = list.filter((h) => !OURS.test(h.command ?? ""));
          if (!c.hooks[ev].length) delete c.hooks[ev];
        }
        for (const [ev, list] of Object.entries(ours || {})) c.hooks[ev] = [...(c.hooks[ev] ?? []), ...list];
        return c;
      }),
    rules: null, // Cursor keeps user rules in its settings UI; the session-start brief carries the rule instead
    note: "Cursor has no hook that adds context to a message, so per-message recall is off; the brief, saving and checkpoints work.",
  },
};

// ---------- run ----------

const targets = asked.length ? asked : AGENTS.filter((a) => setups[a].found());
if (!targets.length) fail("No coding agents found (looked for Claude Code, Codex, Gemini CLI and Cursor).");

if (!remove) preflight();
console.log(`${remove ? "Disconnecting" : "Connecting"} ${targets.map((a) => setups[a].name).join(", ")}${dry ? " (dry run)" : ""}\n`);

const notes = [];
for (const a of targets) {
  const s = setups[a];
  try {
    s.mcp(!remove);
    s.hooks(!remove);
    if (s.rules) editText(s.rules, (t) => setRule(t, !remove));
    console.log(`  ✓ ${s.name}: ${remove ? "removed" : "MCP tools, hooks" + (s.rules ? ", memory rule" : "")}`);
    if (!remove && s.note) notes.push(`${s.name}: ${s.note}`);
  } catch (err) {
    console.log(`  ✗ ${s.name}: ${err.message}`);
  }
}

console.log(
  remove
    ? "\nDone. Restart the agents. Backups of the original files are next to them (*.strata-backup)."
    : `\nDone. Restart the agents, then start a new session: it opens with a Strata memory brief.\n${notes.map((n) => `\n  • ${n}`).join("")}`,
);

// ---------- helpers ----------

function preflight() {
  const env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (!/^STRATA_API_KEY=\S+/m.test(env) && !process.env.STRATA_API_KEY)
    fail(`No STRATA_API_KEY in ${ENV_FILE}.\nCreate one first:  pnpm --filter @stratamem/server create-key "me"  and paste it into .env.`);
  if (!existsSync(TSX)) fail("Dependencies are missing. Run  pnpm install  first.");
}

/** A matcher group with one command hook (Claude Code, Codex and Gemini share this shape). */
function group(command, timeout, name) {
  return { hooks: [{ type: "command", command, timeout, ...(name ? { name } : {}) }] };
}

/** Remove Strata's hook groups from every event, then add the new ones. Other hooks are untouched. */
function setHooks(config, ours) {
  config.hooks ??= {};
  for (const [ev, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) continue;
    config.hooks[ev] = groups.filter((g) => !(g.hooks ?? []).some((h) => OURS.test(h.command ?? "")));
    if (!config.hooks[ev].length) delete config.hooks[ev];
  }
  for (const [ev, groups] of Object.entries(ours || {})) config.hooks[ev] = [...(config.hooks[ev] ?? []), ...groups];
  if (!Object.keys(config.hooks).length) delete config.hooks;
  return config;
}

function setMcp(config, key, server) {
  config[key] ??= {};
  if (server) config[key].strata = server;
  else delete config[key].strata;
  return config;
}

/** Keep one marked Strata block in a rules file (also replaces an older unmarked "# Memory (Strata)" section). */
function setRule(text, on) {
  let t = text.replace(/\n*<!-- strata:begin -->[\s\S]*?<!-- strata:end -->\n*/g, "\n\n");
  t = t.replace(/(^|\n)# Memory \(Strata\)\n[\s\S]*?(?=\n# |$)/, "\n");
  t = t.trim();
  if (!on) return t ? `${t}\n` : "";
  return `${t ? `${t}\n\n` : ""}<!-- strata:begin -->\n${RULE}\n<!-- strata:end -->\n`;
}

function editJson(path, fn) {
  let config = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    try {
      config = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${path} is not valid JSON; fix it and run again`);
    }
  }
  write(path, `${JSON.stringify(fn(config), null, 2)}\n`);
}

function editText(path, fn) {
  write(path, fn(existsSync(path) ? readFileSync(path, "utf8") : ""));
}

function write(path, content) {
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (before === content) return;
  if (dry) return console.log(`    would update ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  if (before !== null && !existsSync(`${path}.strata-backup`)) copyFileSync(path, `${path}.strata-backup`);
  writeFileSync(path, content);
}

function run(cmd, argv, ignoreErrors = false) {
  if (dry) return console.log(`    would run: ${cmd} ${argv.join(" ")}`);
  try {
    execFileSync(cmd, argv, { stdio: "pipe" });
  } catch (err) {
    if (!ignoreErrors) throw new Error(`${cmd} ${argv.slice(0, 2).join(" ")} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

function onPath(cmd) {
  try {
    execFileSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function stableNode() {
  try {
    const p = execFileSync("/bin/sh", ["-lc", "command -v node"], { stdio: "pipe" }).toString().trim();
    if (p.startsWith("/")) return p;
  } catch {}
  return process.execPath;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
