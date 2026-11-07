import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { config } from "../config.js";
import { hashKey } from "./keys.js";

export type AuthVars = { workspaceId: string; actor: string };

/** `Authorization: Bearer sk_strata_...` → sets workspaceId and actor (the key's name). */
export const requireApiKey = createMiddleware<{ Variables: AuthVars }>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) throw new HTTPException(401, { message: "missing API key" });

  const [row] = await db
    .select({ id: apiKeys.id, workspaceId: apiKeys.workspaceId, name: apiKeys.name })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) throw new HTTPException(401, { message: "invalid API key" });

  c.set("workspaceId", row.workspaceId);
  c.set("actor", row.name);
  // fire-and-forget usage stamp
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).catch(() => {});
  await next();
});

/** Admin routes (create workspace / key) need STRATA_ADMIN_TOKEN. */
export const requireAdmin = createMiddleware(async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!config.STRATA_ADMIN_TOKEN || token !== config.STRATA_ADMIN_TOKEN) {
    throw new HTTPException(401, { message: "admin token required" });
  }
  await next();
});
