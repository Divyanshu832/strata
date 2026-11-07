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
  asOf: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  // "Today" for relative dates ("last week"); benchmarks pass the question's date.
  now: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
});

export const recallRoutes = new Hono<{ Variables: AuthVars }>()
  .post("/recall", zValidator("json", Recall), async (c) => {
    const { now, ...rest } = c.req.valid("json");
    return c.json(await recall(c.get("workspaceId"), { ...rest, now: now ? new Date(now) : undefined }));
  })
  .post("/answer", zValidator("json", Recall.extend({ model: z.string().optional() })), async (c) => {
    const { now, ...rest } = c.req.valid("json");
    return c.json(await answer(c.get("workspaceId"), { ...rest, now: now ? new Date(now) : undefined }));
  });
