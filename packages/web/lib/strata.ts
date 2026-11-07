import "server-only";
import { Strata } from "@stratamem/sdk";

/**
 * Server-side client. The API key stays on the server (never sent to the browser).
 * Reads STRATA_URL / STRATA_API_KEY from the repo's .env (see next.config / dev script).
 */
export const strata = new Strata({
  baseUrl: process.env.STRATA_URL,
  apiKey: process.env.STRATA_API_KEY ?? "",
});
