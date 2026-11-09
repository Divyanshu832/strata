// Maintenance: merge near-duplicate facts, and find sources to re-extract with a newer extractor.
// Nothing is deleted: a merged duplicate is closed with status 'merged' and points at the fact it was
// merged into. Pinned facts are never merged away.
import { sql } from "drizzle-orm";
import { withWorkspace } from "../db/client.js";
import { EXTRACTOR_VERSION } from "./extract.js";
import { looksLikeName } from "./entities.js";
import { publish } from "./events.js";

/** Same subject and predicate, and statements this close in meaning, count as the same fact. */
const DUPLICATE_SIMILARITY = 0.95;

export type DuplicatePair = { keepId: string; keep: string; dupId: string; dup: string; similarity: number };

export async function findDuplicates(workspaceId: string): Promise<DuplicatePair[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx.execute<{ keep_id: string; keep: string; dup_id: string; dup: string; similarity: number }>(sql`
      select distinct on (b.id) a.id as keep_id, a.statement as keep, b.id as dup_id, b.statement as dup,
        1 - (a.embedding <=> b.embedding) as similarity
      from facts a
      join facts b on b.workspace_id = a.workspace_id and b.subject_id = a.subject_id and b.predicate = a.predicate
        and (a.recorded_at, a.id) < (b.recorded_at, b.id)
      where a.workspace_id = ${workspaceId}
        and a.valid_to is null and b.valid_to is null
        and a.status = 'active' and b.status = 'active' and not b.pinned
        and a.object_id is not distinct from b.object_id
        -- repeated events (gym every week) are separate facts, not duplicates
        and (a.kind <> 'event' or a.valid_from::date = b.valid_from::date)
        and 1 - (a.embedding <=> b.embedding) > ${DUPLICATE_SIMILARITY}
      order by b.id, similarity desc`);
    return rows.map((r) => ({ keepId: r.keep_id, keep: r.keep, dupId: r.dup_id, dup: r.dup, similarity: Number(r.similarity) }));
  });
}

export async function mergeDuplicates(workspaceId: string): Promise<DuplicatePair[]> {
  const pairs = await findDuplicates(workspaceId);
  if (pairs.length === 0) return pairs;
  await withWorkspace(workspaceId, async (tx) => {
    for (const p of pairs) {
      await tx.execute(sql`
        update facts set status = 'merged', valid_to = now(), superseded_by = ${p.keepId}
        where id = ${p.dupId} and valid_to is null`);
    }
  });
  for (const p of pairs) publish(workspaceId, { type: "changed", target: "fact", id: p.dupId, action: "merged" });
  return pairs;
}

/** Sources with current facts made by an older extractor version (agent-written facts excluded). */
export async function staleSources(workspaceId: string): Promise<{ sourceId: string; facts: number; versions: string[] }[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx.execute<{ source_id: string; facts: number; versions: string[] }>(sql`
      select source_id, count(*)::int as facts, array_agg(distinct extractor_version) as versions
      from facts
      where workspace_id = ${workspaceId} and source_id is not null and valid_to is null
        and extractor_version not in ('agent', ${EXTRACTOR_VERSION})
      group by source_id`);
    return rows.map((r) => ({ sourceId: r.source_id, facts: Number(r.facts), versions: r.versions }));
  });
}

export type PhraseNote = { id: string; name: string; facts: number };

/**
 * Notes whose name is a description ("keep one-step COD form"), created before descriptions were stored
 * as values. Only notes that are never a fact's subject qualify, so no fact is lost.
 */
export async function findPhraseNotes(workspaceId: string): Promise<PhraseNote[]> {
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx.execute<{ id: string; name: string; facts: number }>(sql`
      select e.id, e.name, (select count(*)::int from facts f where f.object_id = e.id) as facts
      from entities e
      where e.workspace_id = ${workspaceId}
        and not exists (select 1 from facts f where f.subject_id = e.id)`);
    return rows.filter((r) => !looksLikeName(r.name)).map((r) => ({ id: r.id, name: r.name, facts: Number(r.facts) }));
  });
}

/** Turns each phrase note back into a plain value on the facts that pointed at it, then removes the note. */
export async function fixPhraseNotes(workspaceId: string): Promise<PhraseNote[]> {
  const notes = await findPhraseNotes(workspaceId);
  if (notes.length === 0) return notes;
  await withWorkspace(workspaceId, async (tx) => {
    for (const n of notes) {
      await tx.execute(sql`update facts set object_value = ${n.name}, object_id = null where object_id = ${n.id}`);
      await tx.execute(sql`delete from entities where id = ${n.id}
        and not exists (select 1 from facts f where f.subject_id = ${n.id})`);
    }
  });
  for (const n of notes) publish(workspaceId, { type: "changed", target: "entity", id: n.id, action: "deleted" });
  return notes;
}
