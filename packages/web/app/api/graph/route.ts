import { NextResponse } from "next/server";
import { strata } from "@/lib/strata";

export const dynamic = "force-dynamic";

/** Whole graph (all links with their valid times); the browser filters by date for the time slider. */
export async function GET() {
  return NextResponse.json(await strata.graph());
}
