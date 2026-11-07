import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "../config.js";
import * as schema from "./schema.js";

/** One connection pool for the process. */
export const sql = postgres(config.DATABASE_URL, { max: 10 });
export const db = drizzle(sql, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run work inside a transaction scoped to one workspace.
 * Sets app.workspace_id so the RLS policies only let this workspace's rows through.
 */
export async function withWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(schema.setWorkspace(workspaceId));
    return fn(tx);
  });
}
