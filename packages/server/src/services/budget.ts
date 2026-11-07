// Step 5 of the read path: keep the best items that fit the token budget.
import { estimateTokens } from "../lib/tokens.js";
import type { QueryType } from "./router.js";

/** Defaults per question type. To be tuned from the benchmark budget curves (W5). */
export const DEFAULT_BUDGET: Record<QueryType, number> = {
  count: 800,
  temporal: 1500,
  lookup: 1000,
  episodic: 3000,
  open: 2500,
};

export type Packable = { id: string; text: string; score: number };

export type Packed<T extends Packable> = {
  kept: T[];
  dropped: { id: string; reason: "budget" | "below_threshold" }[];
  tokens: number;
};

/**
 * Greedy packing in score order. Items below `minScore` are dropped as irrelevant, so an
 * empty result is returned instead of filler when nothing matches.
 */
export function pack<T extends Packable>(items: T[], maxTokens: number, minScore = 0): Packed<T> {
  const kept: T[] = [];
  const dropped: Packed<T>["dropped"] = [];
  let tokens = 0;
  for (const item of [...items].sort((a, b) => b.score - a.score)) {
    if (item.score < minScore) {
      dropped.push({ id: item.id, reason: "below_threshold" });
      continue;
    }
    const cost = estimateTokens(item.text);
    if (tokens + cost > maxTokens) {
      dropped.push({ id: item.id, reason: "budget" });
      continue;
    }
    kept.push(item);
    tokens += cost;
  }
  return { kept, dropped, tokens };
}
