import type { Metadata } from "next";
import Link from "next/link";
import { ReviewActions } from "@/components/review-actions";
import { strata } from "@/lib/strata";
import { day, displayName, predicateLabel, statementText } from "@/lib/format";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const { contradictions } = await strata.review();

  return (
    <div className="mx-auto max-w-[860px] px-6 py-8">
      <h1 className="text-[26px] font-semibold tracking-tight">Review</h1>
      <p className="mt-1 max-w-[64ch] text-muted">
        Facts that can only have one value, where two values claim the same time. Strata keeps both and asks you
        instead of guessing. Nothing is deleted either way: the losing value stays in history.
      </p>

      {contradictions.length === 0 ? (
        <div className="mt-10 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="font-medium">Nothing to review</p>
          <p className="mt-1 text-[13.5px] text-muted">Conflicting facts will show up here when agents disagree.</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {contradictions.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-panel">
              <div className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3">
                <p className="text-[15px]">
                  <Link href={`/notes/${c.subjectId}`} className="wikilink">
                    {displayName(c.subject)}
                  </Link>{" "}
                  <span className="text-muted">{predicateLabel(c.predicate)}</span>
                </p>
                <span className="text-[12.5px] text-faint">flagged {day(c.recordedAt)}</span>
              </div>
              <div className="grid gap-px bg-line md:grid-cols-2">
                <div className="bg-panel px-5 py-4">
                  <p className="text-[12.5px] text-muted">Known before</p>
                  {c.conflictsWith.length === 0 ? (
                    <p className="mt-1 text-[14.5px] text-faint">The earlier value is no longer current.</p>
                  ) : (
                    c.conflictsWith.map((o) => (
                      <div key={o.id} className="mt-1">
                        <p className="text-[15px]">{statementText(o.statement)}</p>
                        <p className="text-[12.5px] text-faint">
                          since {day(o.validFrom)}
                          {o.sourceId && (
                            <>
                              {" · "}
                              <Link href={`/sources/${o.sourceId}`} className="hover:text-soft hover:underline">source</Link>
                            </>
                          )}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <div className="bg-panel px-5 py-4">
                  <p className="text-[12.5px] text-cinnabar">New, conflicting</p>
                  <p className="mt-1 text-[15px]">{statementText(c.statement)}</p>
                  <p className="text-[12.5px] text-faint">
                    since {day(c.validFrom)}
                    {c.sourceId && (
                      <>
                        {" · "}
                        <Link href={`/sources/${c.sourceId}`} className="hover:text-soft hover:underline">source</Link>
                      </>
                    )}
                  </p>
                  {c.sourceContent && <p className="mt-2 border-l-2 border-line-strong pl-3 text-[13px] text-muted">“{c.sourceContent.slice(0, 220)}”</p>}
                </div>
              </div>
              <div className="px-5 py-3">
                <ReviewActions id={c.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
