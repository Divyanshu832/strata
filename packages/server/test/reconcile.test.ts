import { describe, expect, it } from "vitest";
import { normaliseValue, reconcile } from "../src/services/reconcile.js";

const d = (s: string) => new Date(s);

describe("reconcile", () => {
  it("adds a fact when nothing is known", () => {
    expect(reconcile([], { objectKey: "bhopal", exclusive: true, validFrom: d("2026-01-01") })).toEqual({ action: "add" });
  });

  it("skips an exact duplicate", () => {
    const r = reconcile([{ id: "a", objectKey: "bhopal", validFrom: d("2026-01-01") }], {
      objectKey: "bhopal", exclusive: true, validFrom: d("2026-05-01"),
    });
    expect(r).toEqual({ action: "skip", duplicateOf: "a" });
  });

  it("replaces an older value of an exclusive predicate (moved city)", () => {
    const r = reconcile([{ id: "a", objectKey: "bhopal", validFrom: d("2026-01-01") }], {
      objectKey: "pune", exclusive: true, validFrom: d("2026-05-01"),
    });
    expect(r).toEqual({ action: "update", replaces: ["a"] });
  });

  it("flags a contradiction when the new value claims to be older than what we hold", () => {
    const r = reconcile([{ id: "a", objectKey: "pune", validFrom: d("2026-05-01") }], {
      objectKey: "bhopal", exclusive: true, validFrom: d("2026-01-01"),
    });
    expect(r).toEqual({ action: "contradiction", conflictsWith: ["a"] });
  });

  it("adds alongside existing values for non-exclusive predicates (works on several projects)", () => {
    const r = reconcile([{ id: "a", objectKey: "hone", validFrom: d("2026-01-01") }], {
      objectKey: "strata", exclusive: false, validFrom: d("2026-11-01"),
    });
    expect(r).toEqual({ action: "add" });
  });

  it("normalises values", () => {
    expect(normaliseValue("  New   Delhi ")).toBe("new delhi");
  });
});
