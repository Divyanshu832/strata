import type { Metadata } from "next";
import Link from "next/link";
import { strata } from "@/lib/strata";
import { ago, displayName, TYPE_LABEL, TYPE_ORDER, typeColor } from "@/lib/format";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage() {
  const [{ notes }, { sources }] = await Promise.all([strata.notes(), strata.sources({ limit: 12 })]);

  if (notes.length === 0) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-lg font-semibold">No notes yet</h1>
        <p className="mt-2 text-muted">
          Each person, project, place and topic your agents remember gets a note, built from its facts.
          See the Overview page to connect an agent.
        </p>
      </div>
    );
  }

  const known = TYPE_ORDER as readonly string[];
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8 md:px-10">
      <h1 className="text-[26px] font-semibold tracking-tight">Notes</h1>
      <p className="mt-1 text-muted">One note per person, project, place or topic. Notes are built from facts, so they never go stale.</p>

      <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {TYPE_ORDER.map((type) => {
          const group = notes
            .filter((n) => (known.includes(n.type) ? n.type === type : type === "thing"))
            .sort((a, b) => b.facts + b.links - (a.facts + a.links));
          if (group.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-[14px] font-semibold">
                <span className="size-2 rounded-full" style={{ background: typeColor(type) }} />
                {TYPE_LABEL[type]}
                <span className="font-normal text-faint">{group.length}</span>
              </h2>
              <ul>
                {group.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`} className="-mx-2 flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-panel">
                      <span className="truncate">{displayName(n.name)}</span>
                      {n.tags.map((t) => (
                        <span key={t} className="text-[12px] text-faint">#{t}</span>
                      ))}
                      <span className="ml-auto shrink-0 text-[12.5px] text-muted">
                        {n.facts} facts · {n.links} backlinks
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-12">
        <h2 className="mb-1 border-b border-line pb-2 text-[14px] font-semibold">Recent sources</h2>
        <p className="mb-2 text-[13px] text-muted">The original messages and documents, kept as they arrived.</p>
        <ul>
          {sources.map((s) => (
            <li key={s.id}>
              <Link href={`/sources/${s.id}`} className="-mx-2 grid grid-cols-[90px_1fr_auto] items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-panel">
                <span className="text-[12.5px] text-muted">{ago(s.occurredAt)}</span>
                <span className="truncate text-soft">{s.content}</span>
                <span className="text-[12.5px] text-faint">{s.facts ? `${s.facts} facts` : s.processedAt ? "text only" : "processing"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
