import { describe, expect, it } from "vitest";
import { pack } from "../src/services/budget.js";
import { rrf } from "../src/services/rrf.js";

describe("pack", () => {
  const items = [
    { id: "a", text: "x".repeat(400), score: 0.9 }, // ~100 tokens
    { id: "b", text: "x".repeat(400), score: 0.8 },
    { id: "c", text: "x".repeat(40), score: 0.7 }, // ~10 tokens
    { id: "d", text: "x".repeat(40), score: 0 },
  ];

  it("keeps the best items that fit and records what was cut", () => {
    const r = pack(items, 120, Number.EPSILON);
    expect(r.kept.map((i) => i.id)).toEqual(["a", "c"]);
    expect(r.dropped).toEqual([
      { id: "b", reason: "budget" },
      { id: "d", reason: "below_threshold" },
    ]);
    expect(r.tokens).toBe(110);
  });

  it("returns nothing rather than filler when nothing is relevant", () => {
    expect(pack([{ id: "z", text: "irrelevant", score: 0 }], 1000, Number.EPSILON).kept).toEqual([]);
  });
});

describe("rrf", () => {
  it("ranks items found by several channels higher", () => {
    const fused = rrf([
      [{ id: "a", channel: "vector", rank: 1, score: 0.9 }, { id: "b", channel: "vector", rank: 2, score: 0.8 }],
      [{ id: "b", channel: "text", rank: 1, score: 0.5 }],
    ]);
    expect(fused[0]!.id).toBe("b");
    expect(fused[0]!.channels.map((c) => c.channel)).toEqual(["vector", "text"]);
  });
});
