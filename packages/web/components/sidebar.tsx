import Link from "next/link";
import { strata, tryStrata } from "@/lib/strata";
import { NoteList } from "./note-list";
import { QuickSwitcher } from "./quick-switcher";
import { Logo } from "./logo";

/** Left sidebar: brand, quick switcher, every note grouped by type. */
export async function Sidebar() {
  const res = await tryStrata(() => strata.notes());
  const notes = res.data?.notes ?? [];

  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-sunk md:flex">
      <Link href="/" className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">Strata</span>
      </Link>
      <div className="px-3 pb-2">
        <QuickSwitcher notes={notes} />
      </div>
      {res.error ? (
        <div className="m-3 rounded-md border border-cinnabar/40 bg-cinnabar-soft p-3 text-[13px] text-soft">
          <p className="font-medium text-text">Can't reach the Strata API.</p>
          <p className="mt-1 text-muted">
            Start it with <code className="text-soft">pnpm dev</code> and check <code className="text-soft">STRATA_URL</code> and{" "}
            <code className="text-soft">STRATA_API_KEY</code> in .env.
          </p>
        </div>
      ) : (
        <NoteList notes={notes} />
      )}
    </aside>
  );
}
