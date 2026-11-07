// Runs migrations/*.sql in name order, once each. Applied files are recorded in _migrations.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "../config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../migrations");

const sql = postgres(config.DATABASE_URL, { max: 1 });

try {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log("migrations up to date");
} finally {
  await sql.end();
}
