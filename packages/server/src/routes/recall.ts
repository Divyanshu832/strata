import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AuthVars } from "../lib/auth.js";
import { recall } from "../services/recall.js";
import { answer } from "../services/answer.js";

const Recall = z.object({
  query: z.string().min(1),
  maxTokens: z.number().int().min(100).max(32_000).optional(),
  scopes: z.array(z.string()).optional(),
  hops: z.number().int().min(0).max(3).optional(),
  explain: z.boolean().optional(),
});

export const recallRoutes = new Hono<{ Variables: AuthVars }>()
  .post("/recall", zValidator("json", Recall), async (c) => c.json(await recall(c.get("workspaceId"), c.req.valid("json"))))
  .post("/answer", zValidator("json", Recall.extend({ model: z.string().optional() })), async (c) =>
    c.json(await answer(c.get("workspaceId"), c.req.valid("json"))),
  );
