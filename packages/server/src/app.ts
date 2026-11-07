import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { requireAdmin, requireApiKey, type AuthVars } from "./lib/auth.js";
import { memories } from "./routes/memories.js";
import { recallRoutes } from "./routes/recall.js";
import { notes } from "./routes/notes.js";
import { admin } from "./routes/admin.js";

const v1 = new Hono<{ Variables: AuthVars }>()
  .use("*", requireApiKey)
  .route("/", memories)
  .route("/", recallRoutes)
  .route("/", notes);

export const app = new Hono()
  .use("*", logger())
  .use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["authorization", "content-type"] }))
  .get("/health", (c) => c.json({ ok: true, service: "strata" }))
  .route("/v1", v1)
  .use("/admin/*", requireAdmin)
  .route("/admin", admin);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export type AppType = typeof app;
