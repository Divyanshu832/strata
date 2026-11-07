import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, workspaces } from "../db/schema.js";
import { generateKey } from "../lib/keys.js";

export async function createWorkspaceWithKey(name: string, keyName = "default") {
  const [ws] = await db.insert(workspaces).values({ name }).returning();
  const key = await createKey(ws!.id, keyName);
  return { workspace: ws!, ...key };
}

export async function createKey(workspaceId: string, name: string) {
  const { key, prefix, hash } = generateKey();
  await db.insert(apiKeys).values({ workspaceId, name, prefix, keyHash: hash });
  return { apiKey: key, prefix }; // the full key is shown once and never stored
}

export const admin = new Hono()
  .get("/workspaces", async (c) =>
    c.json({ workspaces: await db.select().from(workspaces).orderBy(desc(workspaces.createdAt)) }),
  )
  // Deletes a whole workspace and everything in it. Admin only; used to clean up benchmark runs.
  .delete("/workspaces/:id", async (c) => {
    const [gone] = await db.delete(workspaces).where(eq(workspaces.id, c.req.param("id"))).returning({ id: workspaces.id });
    return gone ? c.json({ deleted: gone.id }) : c.json({ error: "not found" }, 404);
  })
  .post("/workspaces", zValidator("json", z.object({ name: z.string().min(1) })), async (c) =>
    c.json(await createWorkspaceWithKey(c.req.valid("json").name), 201),
  )
  .post("/workspaces/:id/keys", zValidator("json", z.object({ name: z.string().min(1) })), async (c) =>
    c.json(await createKey(c.req.param("id"), c.req.valid("json").name), 201),
  );
