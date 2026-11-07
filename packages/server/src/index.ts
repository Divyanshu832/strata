import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { startQueue } from "./jobs/queue.js";

await startQueue();
serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`strata api on http://localhost:${info.port}`);
});
