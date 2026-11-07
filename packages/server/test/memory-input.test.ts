import { describe, expect, it } from "vitest";
import { MemoryPayload, statementOf } from "../src/services/memory-input.js";
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
});
