import { describe, expect, it } from "vitest";
import { formatChain, graphAt, noteFileName, renderNoteMarkdown, type Graph } from "../src/services/notes.js";

const d = (s: string) => new Date(s);

describe("renderNoteMarkdown", () => {
  const md = renderNoteMarkdown({
    name: "Harshit",
    type: "person",
    aliases: ["H. Makraria"],
    tags: ["friend"],
    facts: [
      { id: "1", predicate: "works_on", statement: "", objectId: "s", objectName: "Strata", objectValue: null, validFrom: d("2026-10-01"), validTo: null, status: "active", sourceId: null },
      { id: "2", predicate: "lives_in", statement: "", objectId: "p", objectName: "Pune", objectValue: null, validFrom: d("2026-05-01"), validTo: null, status: "active", sourceId: null },
      { id: "3", predicate: "lives_in", statement: "", objectId: "b", objectName: "Bhopal", objectValue: null, validFrom: d("2025-01-01"), validTo: d("2026-05-01"), status: "replaced", sourceId: null },
    ],
    backlinks: [{ factId: "9", fromId: "u", fromName: "user", predicate: "knows" }],
  });

  it("writes Obsidian frontmatter and [[links]]", () => {
    expect(md).toContain('aliases: ["H. Makraria"]');
    expect(md).toContain("works on [[Strata]] (since 2026-10-01)");
  });

  it("keeps history instead of dropping replaced facts", () => {
    expect(md).toContain("## History");
    expect(md).toContain("lives in [[Bhopal]] (2025-01-01 → 2026-05-01)");
  });

  it("lists backlinks", () => {
    expect(md).toContain("[[user]] knows this");
  });
});

describe("graph helpers", () => {
  const graph: Graph = {
    nodes: [
      { id: "h", name: "Harshit", type: "person", degree: 2 },
      { id: "s", name: "Strata", type: "project", degree: 2 },
      { id: "db", name: "Supabase", type: "thing", degree: 1 },
      { id: "b", name: "Bhopal", type: "place", degree: 0 },
    ],
    edges: [
      { id: "1", source: "h", target: "s", predicate: "works_on", validFrom: d("2026-10-01"), validTo: null, status: "active" },
      { id: "2", source: "s", target: "db", predicate: "uses", validFrom: d("2026-11-02"), validTo: null, status: "active" },
      { id: "3", source: "h", target: "b", predicate: "lives_in", validFrom: d("2025-01-01"), validTo: d("2026-05-01"), status: "replaced" },
    ],
  };

  it("formats the connected chain an agent receives", () => {
    expect(formatChain(graph, ["h"])).toBe(
      ["Harshit", "  works_on → Strata (since 2026-10-01)", "Strata", "  uses → Supabase (since 2026-11-02)"].join("\n"),
    );
  });

  it("shows the graph as it was at a date (time slider)", () => {
    const march = graphAt(graph, d("2026-03-01"));
    expect(march.edges.map((e) => e.id)).toEqual(["3"]);
    expect(march.nodes.map((n) => n.id).sort()).toEqual(["b", "h"]);
  });

  it("makes safe file names", () => {
    expect(noteFileName("A/B: test?")).toBe("A-B- test-.md");
  });
});
