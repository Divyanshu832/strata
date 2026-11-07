import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as sql_, sql as sqlTag } from "drizzle-orm";
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
    // Drop to the non-superuser role so the RLS policies actually apply (superusers bypass them).
    if (config.DB_APP_ROLE) await tx.execute(sql_.raw(`set local role ${config.DB_APP_ROLE}`));
    return fn(tx);
  });
}

/**
 * Pass a JS array as ONE Postgres array parameter. (Drizzle's sql`` expands a bare array into a list
 * `($1, $2)`, which is wrong for `= any(...)`, `unnest(...)` and array columns.)
 */
export const uuids = (xs: string[]) => sqlTag`${sqlTag.param(xs)}::uuid[]`;
export const texts = (xs: string[]) => sqlTag`${sqlTag.param(xs)}::text[]`;

/** A Date as a timestamptz parameter (raw postgres.js params don't serialise Date objects). */
export const at = (d: Date) => sqlTag`${d.toISOString()}::timestamptz`;
