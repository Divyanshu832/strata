// Step 4 of the write path: decide what a new candidate fact does to existing memory.
// Pure function, so the rules are unit-tested without a database.

export type CurrentFact = {
  id: string;
  objectKey: string; // object entity id or normalised value
  validFrom: Date;
};

export type Candidate = {
  objectKey: string;
  exclusive: boolean; // only one value at a time (lives_in, job_title)
  validFrom: Date;
};

export type Decision =
  | { action: "add" }
  | { action: "skip"; duplicateOf: string }
  | { action: "update"; replaces: string[] } // close the old facts' valid_to at candidate.validFrom
  | { action: "history"; closeAt: Date; supersededBy: string; replaces: string[] } // an older value: store it already closed
  | { action: "contradiction"; conflictsWith: string[] }; // same time, different value: keep both, flag

export function reconcile(current: CurrentFact[], candidate: Candidate): Decision {
  const dup = current.find((f) => f.objectKey === candidate.objectKey);
  if (dup) return { action: "skip", duplicateOf: dup.id };

  if (!candidate.exclusive || current.length === 0) return { action: "add" };

  // Exclusive predicate with a different value:
  //  - claims the same start time as a value we hold → we can't tell who is right: flag it;
  //  - newer than what we hold → it replaces the old value (old one closed, kept as history);
  //  - older than what we hold → it is history: stored already closed where the newer value starts.
  const t = +candidate.validFrom;
  const same = current.filter((f) => +f.validFrom === t);
  if (same.length > 0) return { action: "contradiction", conflictsWith: same.map((f) => f.id) };
  const older = current.filter((f) => +f.validFrom < t).map((f) => f.id);
  const newer = current.filter((f) => +f.validFrom > t);
  if (newer.length === 0) return { action: "update", replaces: older };
  const next = newer.reduce((a, b) => (+b.validFrom < +a.validFrom ? b : a));
  return { action: "history", closeAt: next.validFrom, supersededBy: next.id, replaces: older };
}

/** Normalise a plain object value so "Bhopal" and " bhopal " count as the same. */
export const normaliseValue = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
