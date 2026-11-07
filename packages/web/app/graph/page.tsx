import type { Metadata } from "next";
import { GraphExplorer } from "@/components/graph-explorer";
import { strata } from "@/lib/strata";

export const metadata: Metadata = { title: "Graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  const [{ at }, graph] = await Promise.all([searchParams, strata.graph()]);
  return <GraphExplorer initial={graph} initialAt={at} />;
}
