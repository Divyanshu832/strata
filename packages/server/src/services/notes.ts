// Obsidian-like view of memory: every entity is a note, every entity-to-entity fact is a [[link]].
// Notes are generated from the facts table (never stored), so they always match the facts.

export type NoteFact = {
  id: string;
  predicate: string;
  statement: string;
  objectId: string | null;
  objectName: string | null;
  objectValue: string | null;
  validFrom: Date;
  validTo: Date | null;
  status: "active" | "replaced" | "contradiction";
  sourceId: string | null;
};

export type Backlink = { factId: string; fromId: string; fromName: string; predicate: string };

export type NoteInput = {
  name: string;
  type: string;
  aliases: string[];
  tags: string[];
  facts: NoteFact[]; // facts where this entity is the subject (current and past)
  backlinks: Backlink[];
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Markdown for one note, Obsidian-compatible: frontmatter, [[links]], history, backlinks. */
export function renderNoteMarkdown(note: NoteInput): string {
  const current = note.facts.filter((f) => f.validTo === null && f.status !== "replaced");
  const history = note.facts.filter((f) => f.validTo !== null).sort((a, b) => +b.validFrom - +a.validFrom);
  const flagged = current.filter((f) => f.status === "contradiction");

  const object = (f: NoteFact) => (f.objectName ? `[[${f.objectName}]]` : (f.objectValue ?? ""));
  const lines: string[] = [
    "---",
    `type: ${note.type}`,
    `aliases: [${note.aliases.map((a) => JSON.stringify(a)).join(", ")}]`,
    `tags: [${note.tags.join(", ")}]`,
    "---",
    `# ${note.name}`,
    "",
  ];

  if (current.length) {
    lines.push("## Facts");
    for (const f of current) {
      const flag = f.status === "contradiction" ? " ⚠️ conflicting" : "";
      lines.push(`- ${f.predicate.replace(/_/g, " ")} ${object(f)} (since ${day(f.validFrom)})${flag}`);
    }
    lines.push("");
  }
  if (history.length) {
    lines.push("## History");
    for (const f of history) {
      lines.push(`- ${f.predicate.replace(/_/g, " ")} ${object(f)} (${day(f.validFrom)} → ${day(f.validTo!)})`);
    }
    lines.push("");
  }
  if (flagged.length) {
    lines.push(`> ${flagged.length} conflicting fact(s) to review.`, "");
  }
  if (note.backlinks.length) {
    lines.push("## Linked from");
    for (const b of note.backlinks) lines.push(`- [[${b.fromName}]] ${b.predicate.replace(/_/g, " ")} this`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- Graph ---------------------------------------------------------------------

export type GraphNode = { id: string; name: string; type: string; degree: number };
export type GraphEdge = {
  id: string; // fact id
  source: string;
  target: string;
  predicate: string;
  validFrom: Date;
  validTo: Date | null;
  status: NoteFact["status"];
};
export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * The connected chain an agent gets back from recall, as compact text:
 *   Harshit
 *     works_on → Strata (since 2026-10-01)
 */
export function formatChain(graph: Graph, startIds: string[], at?: Date): string {
  const holds = (e: GraphEdge) => (at ? e.validFrom <= at && (e.validTo === null || e.validTo > at) : e.validTo === null);
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  const out: string[] = [];
  const seen = new Set<string>();
  const order = [...startIds, ...graph.nodes.map((n) => n.id).filter((id) => !startIds.includes(id))];
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const edges = graph.edges.filter((e) => e.source === id && holds(e)).sort((a, b) => +b.validFrom - +a.validFrom);
    if (edges.length === 0) continue;
    out.push(names.get(id) ?? id);
    // Repeated events collapse to one line: "visited → Gym (4×, latest 2026-11-02)".
    const groups = new Map<string, GraphEdge[]>();
    for (const e of edges) groups.set(`${e.predicate}|${e.target}`, [...(groups.get(`${e.predicate}|${e.target}`) ?? []), e]);
    for (const group of groups.values()) {
      const e = group[0]!;
      const when = group.length > 1 ? `${group.length}×, latest ${day(e.validFrom)}` : `since ${day(e.validFrom)}`;
      const flag = group.some((g) => g.status === "contradiction") ? ", conflicting" : "";
      out.push(`  ${e.predicate} → ${names.get(e.target) ?? e.target} (${when}${flag})`);
    }
  }
  return out.join("\n");
}

/** Edges that were true at a moment in time (the graph time slider). */
export function graphAt(graph: Graph, at: Date): Graph {
  const edges = graph.edges.filter((e) => e.validFrom <= at && (e.validTo === null || e.validTo > at));
  const used = new Set(edges.flatMap((e) => [e.source, e.target]));
  return { nodes: graph.nodes.filter((n) => used.has(n.id)), edges };
}

/** Safe file name for the Obsidian export. */
export const noteFileName = (name: string) => `${name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim()}.md`;
