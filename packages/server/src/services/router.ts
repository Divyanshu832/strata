// Step 1 of the read path: decide which kind of question this is. Rules first; an LLM fallback
// can be added for unclear cases (TODO W3), but rules already cover most count and date questions.

export type QueryType = "count" | "temporal" | "episodic" | "lookup" | "open";

export type TimeRange = { from?: Date; to?: Date };

export type Route = {
  type: QueryType;
  range?: TimeRange; // parsed date window, if any
  asOf?: Date; // "what was true on <date>"
  latest?: boolean; // "when did I last..."
  reason: string; // shown in explain traces
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function routeQuery(query: string, now: Date = new Date()): Route {
  const q = query.toLowerCase();
  const range = parseRange(q, now);

  if (/\bhow (many|often)\b|\bnumber of\b|\bcount\b|\bhow many times\b/.test(q)) {
    return { type: "count", range, reason: "count words (how many / how often)" };
  }
  if (/\b(last|latest|most recent(ly)?)\b.*\b(time|did|was|when)\b|\bwhen did i last\b/.test(q)) {
    return { type: "temporal", latest: true, range, reason: "asks for the latest occurrence" };
  }
  const asOf = /\b(on|as of|at)\s+(\d{4}-\d{2}-\d{2})\b/.exec(q);
  if (asOf?.[2] && /\b(was|were|had|did)\b/.test(q)) {
    return { type: "temporal", asOf: new Date(asOf[2]), reason: "what was true on a date" };
  }
  if (range && /\b(was|were|did|said|changed|before|after|during)\b/.test(q)) {
    return { type: "temporal", range, reason: "past tense with a date window" };
  }
  if (/\bwhat (did we|have we) (decide|agree|plan|discuss)|\bwhat happened\b|\bremember when\b/.test(q)) {
    return { type: "episodic", range, reason: "asks about a past event or decision" };
  }
  if (/^(what|who|where|which|whose)\b|^how (long|much|old|far|big)\b|^(do|does|did|is|are|am) (i|my|we)\b/.test(q)) {
    return { type: "lookup", reason: "direct fact question" };
  }
  return { type: "open", range, reason: "no specific pattern" };
}

/** Very small date parser: ISO dates, "in <month> [year]", "<year>", "last week/month/year". */
export function parseRange(q: string, now: Date): TimeRange | undefined {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q);
  if (iso) {
    const from = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return { from, to: new Date(from.getTime() + 86_400_000) };
  }
  const month = new RegExp(`\\b(${MONTHS.join("|")})\\b(?:\\s+(\\d{4}))?`).exec(q);
  if (month?.[1]) {
    const m = MONTHS.indexOf(month[1]);
    let y = month[2] ? Number(month[2]) : now.getUTCFullYear();
    if (!month[2] && m > now.getUTCMonth()) y -= 1; // "in December" asked in March = last December
    return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)) };
  }
  const rel = /\blast (week|month|year)\b/.exec(q);
  if (rel) {
    const days = rel[1] === "week" ? 7 : rel[1] === "month" ? 30 : 365;
    return { from: new Date(now.getTime() - days * 86_400_000), to: now };
  }
  const year = /\b(?:in|during)\s+(20\d{2})\b/.exec(q);
  if (year) {
    const y = Number(year[1]);
    return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  return undefined;
}
