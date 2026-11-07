import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// One .env for the whole repo (STRATA_URL, STRATA_API_KEY live at the root).
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const config: NextConfig = {
  // The SDK is a TypeScript workspace package; Next compiles it.
  transpilePackages: ["@stratamem/sdk"],
};

export default config;
