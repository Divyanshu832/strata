import { homedir } from "node:os";
import path from "node:path";
import Link from "next/link";
import { StrataBand, TypeLegend } from "@/components/strata-band";
import { strata } from "@/lib/strata";
import { ago, displayName, num, statementText } from "@/lib/format";

export default async function Overview() {
  const [stats, graph, status] = await Promise.all([strata.stats(), strata.graph(), strata.status()]);
  // Shown as $HOME/… : the shell expands it when you run the command, and the page doesn't print your user name.
  const abs = path.resolve(process.cwd(), "..", "..");
  const repoDir = abs.startsWith(homedir()) ? `"$HOME${abs.slice(homedir().length)}"` : abs;
  const empty = stats.currentFacts === 0 && stats.sources === 0;

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-8 md:px-10">
      <section>
        <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em]">
          {empty ? "Memory is empty" : `${num(stats.currentFacts)} things your agents know`}
        </h1>
        <p className="mt-1.5 max-w-[66ch] text-[15px] text-muted">
          {empty
            ? "Connect an agent below. Everything it remembers lands here as notes, links and history."
            : `Spread over ${num(stats.notes)} notes, linked ${num(stats.links)} times. ${num(stats.historyFacts)} older facts are kept as history, and ${num(stats.sources)} original messages are stored as they arrived.`}
        </p>

        {!empty && (
          <div className="mt-7 rounded-xl border border-line bg-sunk px-5 pt-4 pb-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted">Links held over time, by type of note</p>
              <TypeLegend types={[...new Set(graph.nodes.map((n) => n.type))]} />
            </div>
            <StrataBand graph={graph} height={150} />
          </div>
        )}
      </section>

      {stats.contradictions > 0 && (
        <Link
          href="/review"
          className="mt-6 flex items-center justify-between rounded-lg border border-cinnabar/40 bg-cinnabar-soft px-4 py-3 text-[14px] hover:border-cinnabar"
        >
          <span>
            {stats.contradictions === 1 ? "One fact conflicts with earlier memory and needs" : `${stats.contradictions} facts conflict with earlier memory and need`} a decision.
          </span>
          <span className="font-medium text-cinnabar">Review</span>
        </Link>
      )}

      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-2 border-b border-line pb-2 text-[15px] font-semibold">Recently learned</h2>
          {stats.recent.length === 0 ? (
            <p className="py-2 text-[13.5px] text-muted">Nothing yet.</p>
          ) : (
            <ul>
              {stats.recent.map((f) => (
                <li key={f.id} className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-line/60 py-2">
                  <span className={f.status === "replaced" || f.status === "merged" ? "text-muted line-through decoration-faint" : ""}>
                    {statementText(f.statement)}
                    {f.status === "contradiction" && <span className="ml-2 text-[12px] text-cinnabar">conflicting</span>}
                  </span>
                  <span className="text-[12.5px] whitespace-nowrap text-faint">
                    <Link href={`/notes/${f.subjectId}`} className="hover:text-soft hover:underline">{displayName(f.subject)}</Link> · {ago(f.recordedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 border-b border-line pb-2 text-[15px] font-semibold">Connect an agent</h2>
          <p className="text-[13.5px] text-muted">One command connects Claude Code, Codex, Gemini CLI and Cursor: the memory tools, plus hooks that recall on every message and save every decision. Your agent extracts the facts, so Strata needs no model of its own.</p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-panel px-4 py-3 text-[12.5px] leading-relaxed text-soft">
            pnpm --dir {repoDir} connect
          </pre>
          <p className="mt-3 text-[13.5px] text-muted">From your own code:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-panel px-4 py-3 text-[12.5px] leading-relaxed text-soft">{`await strata.remember({ facts: [
  { subject: "user", predicate: "lives_in",
    object: "Pune", exclusive: true },
] });
await strata.recall({ query: "Where do I live?" });`}</pre>
          <dl className="mt-5 space-y-1 text-[13px]">
            <div className="flex justify-between"><dt className="text-muted">Embeddings</dt><dd className="text-soft">on this machine</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Server model</dt><dd className="text-soft">{status.extractor === "none" ? "none needed" : "OpenRouter"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Raw text stored</dt><dd className="text-soft">{num(stats.chunks)} searchable chunks</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
