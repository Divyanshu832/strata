import { createHash, randomBytes } from "node:crypto";

/** New API key: `sk_strata_<random>`. Only the hash is stored. */
export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = `sk_strata_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 14), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
