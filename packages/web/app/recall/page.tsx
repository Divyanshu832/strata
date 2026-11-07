import type { Metadata } from "next";
import { RecallLab } from "@/components/recall-lab";
import { strata } from "@/lib/strata";

export const metadata: Metadata = { title: "Recall" };

export default async function RecallPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, graph] = await Promise.all([searchParams, strata.graph()]);
  return <RecallLab graph={graph} initialQuery={q} />;
}
