import type { Metadata } from "next";
import { Sidebar, Tabs } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strata",
  description: "Memory for your AI agents: notes, links and a graph over time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Tabs />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
