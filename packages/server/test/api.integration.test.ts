// End-to-end tests against a real Postgres (the one in DATABASE_URL). Each run uses two fresh workspaces
// and deletes them afterwards. Skipped when the database isn't reachable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { config } from "../src/config.js";

const reachable = await (async () => {
  const probe = postgres(config.DATABASE_URL, { max: 1, connect_timeout: 2 });
  try {
    await probe`select 1 from facts limit 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
})();

describe.skipIf(!reachable)("API against Postgres", async () => {
  const { app } = await import("../src/app.js");
  const { createWorkspaceWithKey } = await import("../src/routes/admin.js");
  const { db, sql } = await import("../src/db/client.js");
  const { workspaces } = await import("../src/db/schema.js");
  const { inArray } = await import("drizzle-orm");

  let key = "";
  let otherKey = "";
  const ids: string[] = [];

  const call = async (method: string, path: string, body?: unknown, k = key) => {
    const res = await app.request(`/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };

  beforeAll(async () => {
    const a = await createWorkspaceWithKey(`test-${Date.now()}`);
    const b = await createWorkspaceWithKey(`test-other-${Date.now()}`);
    key = a.apiKey;
    otherKey = b.apiKey;
    ids.push(a.workspace.id, b.workspace.id);

    const remember = (occurredAt: string, facts: unknown[]) => call("POST", "/memories", { occurredAt, content: "test", facts });
    await remember("2025-01-10T10:00:00Z", [{ subject: "user", predicate: "lives_in", object: "Bhopal", exclusive: true }]);
    await remember("2026-05-01T10:00:00Z", [{ subject: "me", predicate: "lives_in", object: "Pune", exclusive: true }]);
    for (const d of ["2026-10-05", "2026-10-12", "2026-10-19"]) {
      await remember(`${d}T07:00:00Z`, [
        { subject: "user", predicate: "visited", object: "Gym", kind: "event", validFrom: d, statement: `The user went to the gym on ${d}` },
      ]);
    }
  }, 60_000);

  afterAll(async () => {
    await db.delete(workspaces).where(inArray(workspaces.id, ids));
    await sql.end({ timeout: 2 });
  });

  it("rejects requests without a valid key", async () => {
    expect((await call("GET", "/notes", undefined, "sk_strata_nope")).status).toBe(401);
  });

  it("replaces an exclusive fact and keeps the old one as history", async () => {
    const { json } = await call("POST", "/recall", { query: "Where do I live?" });
    expect(json.items[0].text).toContain("Pune");
    const asOf = await call("POST", "/recall", { query: "Where do I live?", asOf: "2025-06-01" });
    expect(asOf.json.items.map((i: any) => i.text).join(" ")).toContain("Bhopal");
    expect(asOf.json.items.map((i: any) => i.text).join(" ")).not.toContain("Pune");
  });

  it("counts repeated events with SQL", async () => {
    const { json } = await call("POST", "/recall", { query: "How many times did I go to the gym?" });
    expect(json.route.type).toBe("count");
    expect(json.answer.value).toBe(3);
    expect(json.answer.factIds).toHaveLength(3);
  });

  it("answers 'when did I last' from the latest row", async () => {
    const { json } = await call("POST", "/recall", { query: "When did I last go to the gym?" });
    expect(json.answer.value.slice(0, 10)).toBe("2026-10-19");
  });

  it("flags a same-time conflict and resolves it without deleting anything", async () => {
    const r = await call("POST", "/memories", {
      content: "test",
      facts: [{ subject: "user", predicate: "lives_in", object: "Mumbai", exclusive: true, validFrom: "2026-05-01T10:00:00Z" }],
    });
    expect(r.json.sources[0].result.contradictions).toBe(1);
    const review = await call("GET", "/review");
    expect(review.json.contradictions).toHaveLength(1);
    const id = review.json.contradictions[0].id;
    expect((await call("POST", `/review/${id}`, { action: "reject" })).status).toBe(200);
    expect((await call("GET", "/review")).json.contradictions).toHaveLength(0);
    expect((await call("GET", `/memories/${id}`)).json.fact.status).toBe("replaced");
  });

  it("returns nothing rather than filler for unrelated questions", async () => {
    const { json } = await call("POST", "/recall", { query: "What is my favourite pizza topping?" });
    expect(json.items).toHaveLength(0);
  });

  it("isolates workspaces", async () => {
    const { json } = await call("GET", "/notes", undefined, otherKey);
    expect(json.notes).toHaveLength(0);
  });

  it("forgets a fact and logs it", async () => {
    const { json } = await call("GET", "/memories?q=gym");
    const id = json.facts[0].id;
    expect((await call("DELETE", `/memories/${id}`)).status).toBe(200);
    expect((await call("GET", `/memories/${id}`)).status).toBe(404);
    const audit = await call("GET", "/audit");
    expect(audit.json.audit.some((a: any) => a.action === "forget" && a.targetId === id)).toBe(true);
  });
});
