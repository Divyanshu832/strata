/**
 * Cheap token estimate (~4 characters per token for English).
 * Used for packing results into a budget, where speed matters more than exactness.
 * Benchmarks report real token counts from the answer model's usage instead.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
