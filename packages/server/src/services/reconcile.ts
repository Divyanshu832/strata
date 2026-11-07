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
  | { action: "contradiction"; conflictsWith: string[] }; // keep both, flag for review

export function reconcile(current: CurrentFact[], candidate: Candidate): Decision {
  const same = current.find((f) => f.objectKey === candidate.objectKey);
  if (same) return { action: "skip", duplicateOf: same.id };

  if (!candidate.exclusive || current.length === 0) return { action: "add" };

  // Exclusive predicate with a different value. If the new fact is newer, it replaces the old one.
  // If it claims to be older than what we already hold, we can't tell who is right: flag it.
  const older = current.filter((f) => f.validFrom <= candidate.validFrom);
  const newer = current.filter((f) => f.validFrom > candidate.validFrom);
  if (newer.length > 0) return { action: "contradiction", conflictsWith: newer.map((f) => f.id) };
  return { action: "update", replaces: older.map((f) => f.id) };
}

/** Normalise a plain object value so "Bhopal" and " bhopal " count as the same. */
export const normaliseValue = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
