import { describe, expect, it } from "vitest";
import { parseRange, routeQuery } from "../src/services/router.js";

const now = new Date("2026-11-07T12:00:00Z");

describe("routeQuery", () => {
  it("sends count questions to the SQL path", () => {
    expect(routeQuery("How many times did I go to the gym in October?", now).type).toBe("count");
    expect(routeQuery("how often do I call mom", now).type).toBe("count");
  });

  it("detects 'when did I last'", () => {
    const r = routeQuery("When did I last talk to Harshit?", now);
    expect(r.type).toBe("temporal");
    expect(r.latest).toBe(true);
    expect(routeQuery("When did Mira last go climbing?", now).latest).toBe(true);
    expect(routeQuery("when was harshit here last?", now).latest).toBe(true);
    expect(routeQuery("When did I go climbing last week?", now).latest).toBeUndefined();
  });

  it("detects 'what was true on a date'", () => {
    const r = routeQuery("Where was I living on 2026-03-01?", now);
    expect(r.type).toBe("temporal");
    expect(r.asOf?.toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("detects episodic questions", () => {
    expect(routeQuery("What did we decide about the Strata name?", now).type).toBe("episodic");
  });

  it("treats past-tense and how-long questions without dates as lookups", () => {
    expect(routeQuery("What degree did I graduate with?", now).type).toBe("lookup");
    expect(routeQuery("How long is my daily commute?", now).type).toBe("lookup");
  });

  it("detects direct lookups", () => {
    expect(routeQuery("Where does Harshit work?", now).type).toBe("lookup");
  });
});

describe("parseRange", () => {
  it("parses a month in the past year when it hasn't happened yet this year", () => {
    const r = parseRange("in december", new Date("2026-03-10T00:00:00Z"))!;
    expect(r.from!.toISOString().slice(0, 7)).toBe("2025-12");
  });

  it("parses month + year", () => {
    const r = parseRange("in march 2026", now)!;
    expect(r.from!.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(r.to!.toISOString().slice(0, 10)).toBe("2026-04-01");
  });

  it("returns undefined when there is no date", () => {
    expect(parseRange("what is my favourite colour", now)).toBeUndefined();
  });
});
