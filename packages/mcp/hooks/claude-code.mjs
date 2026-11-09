#!/usr/bin/env node
// Deprecated: the first, Claude-only version of the hooks. Kept so existing setups keep working;
// run `pnpm connect` to switch to strata-hook.mjs (which this now forwards to).
const EVENTS = { "session-start": "start", prompt: "prompt", stop: "stop", "pre-compact": "compact", "session-end": "end" };
process.argv.splice(2, 1, "claude", EVENTS[process.argv[2]] ?? process.argv[2]);
await import("./strata-hook.mjs");
