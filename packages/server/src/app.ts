import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { requireAdmin, requireApiKey, type AuthVars } from "./lib/auth.js";
import { memories } from "./routes/memories.js";
import { recallRoutes } from "./routes/recall.js";
import { notes } from "./routes/notes.js";
import { admin } from "./routes/admin.js";
import { workspace } from "./routes/workspace.js";
import { LlmDisabledError } from "./services/llm.js";

const v1 = new Hono<{ Variables: AuthVars }>()
  .use("*", requireApiKey)
  .route("/", memories)
  .route("/", recallRoutes)
  .route("/", notes)
  .route("/", workspace);

export const app = new Hono()
  .use("*", logger())
  .use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["authorization", "content-type"] }))
  .get("/health", (c) => c.json({ ok: true, service: "strata" }))
  .route("/v1", v1)
  .use("/admin/*", requireAdmin)
  .route("/admin", admin);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof LlmDisabledError) return c.json({ error: err.message }, 501);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export type AppType = typeof app;
