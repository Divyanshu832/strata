// Step 3 of the write path: map a name from the text to one canonical entity.
// Order: exact name or alias → close spelling (trigram) → create new.
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { texts } from "../db/client.js";
import { entities, type Entity } from "../db/schema.js";

const SIMILARITY_THRESHOLD = 0.6;

export async function resolveEntity(
  tx: Tx,
  workspaceId: string,
  input: { name: string; type?: string; aliases?: string[] },
): Promise<Entity> {
  const name = canonicalName(input.name);
  const names = [name, ...(input.aliases ?? [])].map((n) => n.toLowerCase());

  const exact = await tx.execute<Entity>(sql`
    select * from entities
    where workspace_id = ${workspaceId}
      and (lower(name) = any(${texts(names)}) or exists (
        select 1 from unnest(aliases) a where lower(a) = any(${texts(names)})))
    limit 1`);
  if (exact[0]) return addAliases(tx, exact[0], input.aliases ?? []);

  const close = await tx.execute<Entity & { score: number }>(sql`
    select *, similarity(name, ${name}) as score from entities
    where workspace_id = ${workspaceId} and similarity(name, ${name}) > ${SIMILARITY_THRESHOLD}
    order by score desc limit 1`);
  if (close[0]) return addAliases(tx, close[0], [name, ...(input.aliases ?? [])]);
  // Deliberately no fuzzier matching: a wrong merge silently mixes two people's facts, while a duplicate
  // note is visible and fixable in one click (POST /v1/notes/:id/merge, or the web app).

  const [created] = await tx
    .insert(entities)
    .values({ workspaceId, name, type: input.type ?? "thing", aliases: input.aliases ?? [] })
    .returning();
  return created!;
}

async function addAliases(tx: Tx, entity: Entity, extra: string[]): Promise<Entity> {
  const known = new Set([entity.name, ...entity.aliases].map((a) => a.toLowerCase()));
  const fresh = extra.filter((a) => !known.has(a.toLowerCase()));
  if (fresh.length === 0) return entity;
  await tx.execute(sql`update entities set aliases = aliases || ${texts(fresh)}, updated_at = now() where id = ${entity.id}`);
  return { ...entity, aliases: [...entity.aliases, ...fresh] };
}

/** "me", "I", "myself" all mean the person the agent is helping. */
const SELF = new Set(["user", "me", "i", "myself", "the user"]);
export const canonicalName = (name: string) => (SELF.has(name.trim().toLowerCase()) ? "user" : name.trim());
