import { describe, expect, it } from "vitest";
import { MemoryPayload, statementOf } from "../src/services/memory-input.js";
import { looksLikeName } from "../src/services/entities.js";
import { splitText } from "../src/services/write.js";

describe("agent memory payload", () => {
  it("fills sensible defaults so agents can send the minimum", () => {
    const p = MemoryPayload.parse({ facts: [{ subject: "user", predicate: "lives_in", object: "Pune" }] });
    expect(p.facts[0]).toMatchObject({ objectType: "entity", kind: "fact", exclusive: false });
    expect(p.entities).toEqual([]);
  });

  it("writes a statement when the agent leaves it out", () => {
    const [f] = MemoryPayload.parse({ facts: [{ subject: "user", predicate: "works_on", object: "Strata" }] }).facts;
    expect(statementOf(f!)).toBe("user works on Strata");
  });

  it("rejects facts missing required parts", () => {
    expect(MemoryPayload.safeParse({ facts: [{ subject: "user", predicate: "lives_in" }] }).success).toBe(false);
  });
});

describe("splitText", () => {
  it("keeps short text as one chunk", () => {
    expect(splitText("Hello there. How are you?")).toEqual(["Hello there. How are you?"]);
  });

  it("splits long text on sentence boundaries", () => {
    const sentence = "This is a sentence about memory. ";
    const parts = splitText(sentence.repeat(100), 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 200)).toBe(true);
    expect(parts.every((p) => p.endsWith("."))).toBe(true);
  });

  it("cuts transcripts between turns and keeps line breaks", () => {
    const turn = (who: string, i: number) => `${who}: message number ${i} with some words in it.`;
    const text = Array.from({ length: 30 }, (_, i) => turn(i % 2 ? "assistant" : "user", i)).join("\n");
    const parts = splitText(text, 200);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => /^(user|assistant): /.test(p))).toBe(true);
    expect(parts[0]).toContain("\n");
  });
});

describe("looksLikeName", () => {
  it("keeps real names as notes", () => {
    for (const n of ["Kaching Bundles", "video-gen", "Amazon ML Challenge 2026", "Bioceutica Milano tote bag product",
      "RITARDO10", "fal.ai", "Bank of America", "Andrea Rimmaudo"]) expect(looksLikeName(n), n).toBe(true);
  });

  it("turns descriptions into plain values", () => {
    for (const d of ["keep one-step COD form", "caps deal price at list price", "COD button at €0",
      "a pipeline for AI-generated 2D/3D animated story shorts", "~/projects/video-gen/research/reports/x.md",
      "Cash on Delivery at Shopify checkout", "Remotion as the video editor for video-gen, and more",
      "video-gen target cost is $8-9 per 60s video at most"]) expect(looksLikeName(d), d).toBe(false);
  });
});
