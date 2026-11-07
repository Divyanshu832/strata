import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataError, type NoteFact } from "@stratamem/sdk";
import { CoreSample } from "@/components/core-sample";
import { FactRow } from "@/components/fact-row";
import { LocalGraph } from "@/components/local-graph";
import { NoteProperties } from "@/components/note-properties";
import { strata } from "@/lib/strata";
import { day, displayName, predicateLabel, typeColor } from "@/lib/format";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  try {
    return await Promise.all([strata.note(id), strata.neighbours(id, 2), strata.notes()]);
  } catch (err) {
    if (err instanceof StrataError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const { note } = await strata.note(id).catch(() => ({ note: null }));
  return { title: note ? displayName(note.name) : "Note" };
}

export default async function NotePage({ params }: Params) {
  const { id } = await params;
  const [{ note, markdown }, { graph }, { notes }] = await load(id);

  const current = note.facts.filter((f) => f.validTo === null && f.status !== "merged");
  const facts = current.filter((f) => f.kind === "fact");
  const prefs = current.filter((f) => f.kind === "preference");
  const events = note.facts.filter((f) => f.kind === "event" && f.status !== "merged");
  const conflicts = current.filter((f) => f.status === "contradiction");
  const isYou = note.name === "user";

  return (
    <div className="flex min-h-full">
      <article className="min-w-0 flex-1 px-6 py-8 md:px-12">
        <div className="mx-auto max-w-[720px]">
          <header className="mb-8">
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <span className="size-2 rounded-full" style={{ background: typeColor(note.type) }} />
              {note.type}
              {note.aliases.length > 0 && <span className="text-faint">also known as {note.aliases.join(", ")}</span>}
            </p>
            <h1 className="mt-1.5 text-[34px] leading-tight font-semibold tracking-[-0.02em]">{displayName(note.name)}</h1>
            {isYou && (
              <p className="mt-2 max-w-[60ch] text-[14px] text-muted">
                The person your agents help. Facts your agents save about you land here.
              </p>
            )}
          </header>

          {conflicts.length > 0 && (
            <Link
              href="/review"
              className="mb-6 flex items-center justify-between rounded-lg border border-cinnabar/40 bg-cinnabar-soft px-4 py-3 text-[13.5px] hover:border-cinnabar"
            >
              <span>
                {conflicts.length === 1 ? "One fact conflicts" : `${conflicts.length} facts conflict`} with what was known before.
              </span>
              <span className="font-medium text-cinnabar">Review</span>
            </Link>
          )}

          <Section title="Facts" count={facts.length} empty="No current facts.">
            <ul className="-mx-3">
              {facts.map((f) => (
                <FactRow key={f.id} fact={f} />
              ))}
            </ul>
          </Section>

          {prefs.length > 0 && (
            <Section title="Preferences" count={prefs.length}>
              <ul className="-mx-3">
                {prefs.map((f) => (
                  <FactRow key={f.id} fact={f} />
                ))}
              </ul>
            </Section>
          )}

          {events.length > 0 && (
            <Section title="Events" count={events.length}>
              <Events events={events} />
            </Section>
          )}

          {note.facts.some((f) => f.validTo !== null && f.kind !== "event") && (
            <Section title="How it changed">
              <CoreSample facts={note.facts} />
            </Section>
          )}

          <details className="group mt-10 rounded-lg ring-1 ring-line">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-[13px] text-muted hover:text-soft">
              View as Obsidian markdown
            </summary>
            <pre className="overflow-x-auto border-t border-line px-4 py-3 text-[12.5px] leading-relaxed whitespace-pre-wrap text-soft">
              {markdown}
            </pre>
          </details>
        </div>
      </article>

      <aside className="hidden w-[320px] shrink-0 space-y-7 border-l border-line px-5 py-8 lg:block">
        <NoteProperties note={note} others={notes} />

        <section>
          <h2 className="mb-2 text-[13px] font-medium text-soft">
            Linked from <span className="text-faint">{note.backlinks.length}</span>
          </h2>
          {note.backlinks.length === 0 ? (
            <p className="text-[12.5px] text-faint">Nothing links here yet.</p>
          ) : (
            <ul className="space-y-1">
              {note.backlinks.map((b) => (
                <li key={b.factId}>
                  <Link href={`/notes/${b.fromId}`} className="flex items-baseline gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-panel">
                    <span className="size-[6px] shrink-0 translate-y-[-1px] rounded-full" style={{ background: typeColor(b.fromType) }} />
                    <span className="text-text">{displayName(b.fromName)}</span>
                    <span className="truncate text-muted">{predicateLabel(b.predicate)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-medium text-soft">Local graph</h2>
          <LocalGraph graph={graph} focusId={note.id} />
        </section>
      </aside>
    </div>
  );
}

function Section({ title, count, empty, children }: { title: string; count?: number; empty?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <h2 className="mb-2 flex items-baseline gap-2 border-b border-line pb-2 text-[15px] font-semibold">
        {title}
        {count !== undefined && <span className="text-[13px] font-normal text-faint">{count}</span>}
      </h2>
      {count === 0 && empty ? <p className="py-2 text-[13.5px] text-muted">{empty}</p> : children}
    </section>
  );
}

/** Repeated events grouped: "visited Gym · 4 times" with the dates underneath. */
function Events({ events }: { events: NoteFact[] }) {
  const groups = new Map<string, NoteFact[]>();
  for (const e of events) {
    const key = `${e.predicate}|${e.objectId ?? e.objectValue}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <ul className="space-y-3 py-1">
      {[...groups.values()]
        .sort((a, b) => +new Date(b[0]!.validFrom) - +new Date(a[0]!.validFrom))
        .map((g) => {
          const e = g[0]!;
          const dates = [...g].sort((a, b) => +new Date(b.validFrom) - +new Date(a.validFrom));
          return (
            <li key={e.id} className="grid grid-cols-[108px_1fr] gap-3">
              <span className="text-[13px] text-muted">{predicateLabel(e.predicate)}</span>
              <div>
                <p className="text-[14.5px]">
                  {e.objectId ? (
                    <Link href={`/notes/${e.objectId}`} className="wikilink">
                      {e.objectName}
                    </Link>
                  ) : (
                    e.objectValue
                  )}
                  {g.length > 1 && <span className="ml-2 text-[13px] text-muted">{g.length} times</span>}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-faint">
                  {dates.map((d) => (
                    <span key={d.id}>{day(d.validFrom)}</span>
                  ))}
                </p>
              </div>
            </li>
          );
        })}
    </ul>
  );
}
