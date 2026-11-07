import "server-only";
import { Strata } from "@stratamem/sdk";

/**
 * Server-side client. The API key stays on the server (never sent to the browser).
 * Reads STRATA_URL / STRATA_API_KEY from the repo's .env (loaded in next.config.ts).
 */
export const strata = new Strata({
  baseUrl: process.env.STRATA_URL,
  apiKey: process.env.STRATA_API_KEY ?? "",
});

/** For parts of the shell that should degrade instead of failing the whole page. */
export async function tryStrata<T>(fn: () => Promise<T>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
