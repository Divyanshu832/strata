// Step 3 of the write path: map a name from the text to one canonical entity.
// Order: exact name or alias → close spelling (trigram) → create new.
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { entities, type Entity } from "../db/schema.js";

const SIMILARITY_THRESHOLD = 0.6;

export async function resolveEntity(
  tx: Tx,
  workspaceId: string,
  input: { name: string; type?: string; aliases?: string[] },
): Promise<Entity> {
  const name = input.name.trim();
  const names = [name, ...(input.aliases ?? [])].map((n) => n.toLowerCase());

  const exact = await tx.execute<Entity>(sql`
    select * from entities
    where workspace_id = ${workspaceId}
      and (lower(name) = any(${names}) or exists (
        select 1 from unnest(aliases) a where lower(a) = any(${names})))
    limit 1`);
  if (exact[0]) return addAliases(tx, exact[0], input.aliases ?? []);

  const close = await tx.execute<Entity & { score: number }>(sql`
    select *, similarity(name, ${name}) as score from entities
    where workspace_id = ${workspaceId} and similarity(name, ${name}) > ${SIMILARITY_THRESHOLD}
    order by score desc limit 1`);
  if (close[0]) return addAliases(tx, close[0], [name, ...(input.aliases ?? [])]);
  // TODO(W2): embedding similarity + LLM tie-break for unsure matches ("H. Makraria" vs "Harshit").

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
  await tx.execute(sql`update entities set aliases = aliases || ${fresh}, updated_at = now() where id = ${entity.id}`);
  return { ...entity, aliases: [...entity.aliases, ...fresh] };
}
