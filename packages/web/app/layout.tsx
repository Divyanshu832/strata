import type { Metadata } from "next";
import { Geologica } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { TopNav } from "@/components/top-nav";
import { LiveRefresh } from "@/components/live-refresh";
import "./globals.css";

const geologica = Geologica({ subsets: ["latin"], variable: "--font-geologica", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Strata", template: "%s · Strata" },
  description: "Memory for your AI agents: notes, links and a graph over time.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geologica.variable}>
      <body className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopNav />
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
        <LiveRefresh />
      </body>
    </html>
  );
}
