// Human edits from the web app or API. Every change is written to audit_log with before/after.
// Facts are never deleted here: resolving a contradiction closes the losing fact.
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { withWorkspace, type Tx, uuids, texts } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { publish } from "./events.js";

type EntityRow = { id: string; name: string; type: string; aliases: string[]; tags: string[]; summary: string | null };

async function audit(tx: Tx, workspaceId: string, actor: string, action: string, targetType: string, targetId: string, before: unknown, after?: unknown) {
  await tx.insert(auditLog).values({ workspaceId, actor, action, targetType, targetId, before, after });
}

const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];

export async function updateEntity(
  workspaceId: string,
  actor: string,
  id: string,
  patch: Partial<Pick<EntityRow, "name" | "type" | "aliases" | "tags" | "summary">>,
): Promise<EntityRow | null> {
  try {
    const updated = await withWorkspace(workspaceId, async (tx) => {
      const [before] = await tx.execute<EntityRow>(sql`select id, name, type, aliases, tags, summary from entities where id = ${id}`);
      if (!before) return null;
      const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as EntityRow;
      // Renaming keeps the old name as an alias, so agents that still use it find the note.
      if (patch.name && patch.name !== before.name) next.aliases = uniq([...next.aliases, before.name]).filter((a) => a !== next.name);
      const [after] = await tx.execute<EntityRow>(sql`
        update entities set name = ${next.name}, type = ${next.type}, aliases = ${texts(next.aliases)}, tags = ${texts(next.tags)},
          summary = ${next.summary}, updated_at = now()
        where id = ${id} returning id, name, type, aliases, tags, summary`);
      await audit(tx, workspaceId, actor, "edit", "entity", id, before, after);
      return after ?? null;
    });
    if (updated) publish(workspaceId, { type: "changed", target: "entity", id, action: "edit" });
    return updated;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23505") throw new HTTPException(409, { message: "a note with that name already exists" });
    throw err;
  }
}

/** `from` and `into` are the same thing: move facts, aliases and tags into `into`, then drop `from`. */
export async function mergeEntities(workspaceId: string, actor: string, from: string, into: string): Promise<boolean> {
  const ok = await withWorkspace(workspaceId, async (tx) => {
    const rows = await tx.execute<EntityRow>(sql`select id, name, type, aliases, tags, summary from entities where id in (${from}, ${into})`);
    const a = rows.find((r) => r.id === from);
    const b = rows.find((r) => r.id === into);
    if (!a || !b) return false;
    await tx.execute(sql`update facts set subject_id = ${into} where subject_id = ${from}`);
    await tx.execute(sql`update facts set object_id = ${into} where object_id = ${from}`);
    const aliases = uniq([...b.aliases, a.name, ...a.aliases]).filter((x) => x.toLowerCase() !== b.name.toLowerCase());
    await tx.execute(sql`
      update entities set aliases = ${texts(aliases)}, tags = ${texts(uniq([...b.tags, ...a.tags]))}, updated_at = now() where id = ${into}`);
    await audit(tx, workspaceId, actor, "merge", "entity", from, a, { into });
    await tx.execute(sql`delete from entities where id = ${from}`);
    return true;
  });
  if (ok) publish(workspaceId, { type: "changed", target: "entity", id: into, action: "merge" });
  return ok;
}

export async function resolveContradiction(
  workspaceId: string,
  actor: string,
  id: string,
  action: "accept" | "reject" | "keep_both",
): Promise<boolean> {
  const ok = await withWorkspace(workspaceId, async (tx) => {
    const [f] = await tx.execute<{ id: string; subject_id: string; predicate: string; valid_from: string; status: string }>(sql`
      select id, subject_id, predicate, valid_from, status from facts where id = ${id}`);
    if (!f || f.status !== "contradiction") return false;
    const others = await tx.execute<{ id: string }>(sql`
      select id from facts where subject_id = ${f.subject_id} and predicate = ${f.predicate} and id <> ${id} and valid_to is null`);
    const otherIds = others.map((o) => o.id);

    if (action === "accept") {
      await tx.execute(sql`update facts set status = 'active' where id = ${id}`);
      if (otherIds.length) {
        await tx.execute(sql`
          update facts set status = 'replaced', valid_to = greatest(valid_from, ${f.valid_from}::timestamptz), superseded_by = ${id}
          where id = any(${uuids(otherIds)})`);
      }
    } else if (action === "reject") {
      await tx.execute(sql`
        update facts set status = 'replaced', valid_to = valid_from, superseded_by = ${otherIds[0] ?? null} where id = ${id}`);
    } else {
      await tx.execute(sql`update facts set status = 'active' where id = ${id}`);
    }
    await audit(tx, workspaceId, actor, `review:${action}`, "fact", id, { status: "contradiction", others: otherIds });
    return true;
  });
  if (ok) publish(workspaceId, { type: "changed", target: "fact", id, action: `review:${action}` });
  return ok;
}
