import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataError } from "@stratamem/sdk";
import { strata } from "@/lib/strata";
import { day, statementText } from "@/lib/format";

export const metadata: Metadata = { title: "Source" };

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await strata.source(id).catch((err) => {
    if (err instanceof StrataError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  });
  const { source, facts } = data;

  return (
    <div className="mx-auto max-w-[720px] px-6 py-8">
      <p className="text-[13px] text-muted">
        {source.kind} from {source.author ?? "unknown"} · {day(source.occurredAt)} · scope {source.scope}
      </p>
      <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Source</h1>
      <blockquote className="mt-5 rounded-lg border-l-2 border-ochre bg-panel px-5 py-4 text-[15px] leading-relaxed whitespace-pre-wrap">
        {source.content}
      </blockquote>
      <p className="mt-2 text-[12.5px] text-faint">Stored exactly as it arrived. Strata never edits sources.</p>

      <h2 className="mt-10 mb-2 border-b border-line pb-2 text-[15px] font-semibold">
        Facts from this source <span className="text-[13px] font-normal text-faint">{facts.length}</span>
      </h2>
      {facts.length === 0 ? (
        <p className="text-[13.5px] text-muted">
          No facts were extracted. The text is still searchable: recall reads it directly.
        </p>
      ) : (
        <ul className="space-y-1">
          {facts.map((f) => (
            <li key={f.id} className="flex items-baseline gap-3 py-1">
              <Link href={`/notes/${f.subjectId}`} className={f.validTo ? "text-muted line-through decoration-faint" : "hover:text-ochre"}>
                {statementText(f.statement)}
              </Link>
              <span className="ml-auto shrink-0 text-[12.5px] text-faint">
                {f.status === "active" ? `since ${day(f.validFrom)}` : f.status}
                {f.extractorVersion !== "agent" && ` · ${f.extractorVersion}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
