// Background jobs on pg-boss (a job queue that lives in the same Postgres).
// Writes return immediately; extraction runs here so agents are never slowed down.
import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { processSource } from "../services/write.js";

export const QUEUES = {
  extract: "extract-source",
  // TODO(W4): maintenance jobs
  mergeDuplicates: "merge-duplicates",
  summariseEpisodes: "summarise-episodes",
  reextract: "reextract",
} as const;

export type ExtractJob = { workspaceId: string; sourceId: string };

let boss: PgBoss | undefined;

export async function startQueue(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss(config.DATABASE_URL);
  boss.on("error", (err) => console.error("[queue]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  await boss.work<ExtractJob>(QUEUES.extract, async (jobs) => {
    for (const job of jobs) {
      const result = await processSource(job.data.workspaceId, job.data.sourceId);
      console.log(`[extract] source ${job.data.sourceId}:`, result);
    }
  });
  return boss;
}

/** One job per source; singletonKey keeps a source from being queued twice at once. */
export async function enqueueExtract(job: ExtractJob): Promise<void> {
  const q = await startQueue();
  await q.send(QUEUES.extract, job, { singletonKey: job.sourceId, retryLimit: 3, retryBackoff: true });
}
