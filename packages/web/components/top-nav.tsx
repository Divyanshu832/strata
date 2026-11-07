"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" },
  { href: "/notes", label: "Notes", match: (p: string) => p.startsWith("/notes") || p.startsWith("/sources") },
  { href: "/graph", label: "Graph", match: (p: string) => p.startsWith("/graph") },
  { href: "/recall", label: "Recall", match: (p: string) => p.startsWith("/recall") },
  { href: "/review", label: "Review", match: (p: string) => p.startsWith("/review") },
  { href: "/usage", label: "Usage", match: (p: string) => p.startsWith("/usage") },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="flex h-12 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-4">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative px-3 pb-3 text-[13.5px] whitespace-nowrap ${active ? "text-text" : "text-muted hover:text-soft"}`}
          >
            {t.label}
            {active && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-ochre" />}
          </Link>
        );
      })}
    </header>
  );
}
