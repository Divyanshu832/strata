// pnpm --filter @stratamem/server create-key "My workspace"
// Creates a workspace and prints its first API key (shown once).
import { sql } from "../db/client.js";
import { createWorkspaceWithKey } from "../routes/admin.js";

const name = process.argv[2] ?? "default";
const { workspace, apiKey } = await createWorkspaceWithKey(name);
console.log(`workspace: ${workspace.name} (${workspace.id})`);
console.log(`api key:   ${apiKey}`);
console.log("Put it in .env as STRATA_API_KEY. It is not stored and can't be shown again.");
await sql.end();
