import { strata } from "@/lib/strata";

export const dynamic = "force-dynamic";

/** Downloads the memory as an Obsidian vault (.zip of markdown notes with [[links]]). */
export async function GET() {
  const zip = await strata.exportObsidian();
  return new Response(zip, {
    headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="strata-vault.zip"' },
  });
}
