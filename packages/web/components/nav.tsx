import Link from "next/link";

const TABS = [
  { href: "/notes", label: "Notes" },
  { href: "/graph", label: "Graph" },
  { href: "/recall", label: "Recall" },
  { href: "/review", label: "Review" },
  { href: "/usage", label: "Usage" },
];

export function Tabs() {
  return (
    <nav className="flex gap-1 border-b border-border px-3">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="px-3 py-2 text-sm text-muted hover:text-text">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Left sidebar: note list, search and quick switcher (TODO). */
export function Sidebar() {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-panel p-3 text-sm">
      <div className="mb-3 font-semibold">Strata</div>
      <input placeholder="Search notes…" className="mb-3 w-full rounded border border-border bg-bg px-2 py-1" />
      <p className="text-muted">Note list goes here.</p>
    </aside>
  );
}

export function Placeholder({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <section className="p-6">
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <div className="text-sm text-muted">{children}</div>
    </section>
  );
}
