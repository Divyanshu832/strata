// Background jobs on pg-boss (a job queue that lives in the same Postgres).
// - extract-source: raw-text sources (indexed as chunks; Strata extractor too if enabled), so writes
//   return immediately. Facts sent by agents are saved directly, not through the queue.
// - reextract: re-run a newer extractor over a source (old extractor's facts are closed, not deleted).
// - merge-duplicates: nightly, every workspace.
import { PgBoss } from "pg-boss";
import { sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { processRawSource, reextractSource } from "../services/write.js";
import { mergeDuplicates } from "../services/maintenance.js";

export const QUEUES = {
  extract: "extract-source",
  reextract: "reextract",
  mergeDuplicates: "merge-duplicates",
} as const;

export type SourceJob = { workspaceId: string; sourceId: string };

let boss: Promise<PgBoss> | undefined;

export function startQueue(): Promise<PgBoss> {
  return (boss ??= (async () => {
    const b = new PgBoss(config.DATABASE_URL);
    b.on("error", (err) => console.error("[queue]", err));
    await b.start();
    for (const name of Object.values(QUEUES)) await b.createQueue(name);

    await b.work<SourceJob>(QUEUES.extract, async (jobs) => {
      for (const job of jobs) {
        const result = await processRawSource(job.data.workspaceId, job.data.sourceId);
        console.log(`[extract] source ${job.data.sourceId}:`, result);
      }
    });
    await b.work<SourceJob>(QUEUES.reextract, async (jobs) => {
      for (const job of jobs) {
        const result = await reextractSource(job.data.workspaceId, job.data.sourceId);
        console.log(`[reextract] source ${job.data.sourceId}:`, result);
      }
    });
    await b.work(QUEUES.mergeDuplicates, async () => {
      const rows = await db.execute<{ id: string }>(sql`select id from workspaces`);
      for (const { id } of rows) {
        const merged = await mergeDuplicates(id);
        if (merged.length) console.log(`[merge] workspace ${id}: merged ${merged.length} duplicate(s)`);
      }
    });
    await b.schedule(QUEUES.mergeDuplicates, "30 3 * * *"); // 03:30 every night
    return b;
  })());
}

/** One job per source; singletonKey keeps a source from being queued twice at once. */
export async function enqueueExtract(job: SourceJob): Promise<void> {
  await (await startQueue()).send(QUEUES.extract, job, { singletonKey: job.sourceId, retryLimit: 3, retryBackoff: true });
}

export async function enqueueReextract(job: SourceJob): Promise<void> {
  await (await startQueue()).send(QUEUES.reextract, job, { singletonKey: job.sourceId, retryLimit: 2, retryBackoff: true });
}

export async function stopQueue(): Promise<void> {
  if (boss) await (await boss).stop({ graceful: true });
}
