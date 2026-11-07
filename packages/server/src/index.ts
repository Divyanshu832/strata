import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { sql } from "./db/client.js";
import { startQueue, stopQueue } from "./jobs/queue.js";

await startQueue();
const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`strata api on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await stopQueue();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
