"use server";

import { revalidatePath } from "next/cache";
import type { EntityType, RecallResult } from "@stratamem/sdk";
import { strata } from "@/lib/strata";

// Server actions: the browser calls these; the API key never leaves the server.

export async function pinFact(id: string, pinned: boolean) {
  await strata.editFact(id, { pinned });
  revalidatePath("/", "layout");
}

export async function editFactStatement(id: string, statement: string) {
  await strata.editFact(id, { statement });
  revalidatePath("/", "layout");
}

/** "No longer true": closes the fact today, keeps it as history. */
export async function endFact(id: string) {
  await strata.editFact(id, { validTo: new Date().toISOString() });
  revalidatePath("/", "layout");
}

/** Permanent delete (audited). */
export async function forgetFact(id: string) {
  await strata.forget(id);
  revalidatePath("/", "layout");
}

export async function resolveConflict(id: string, action: "accept" | "reject" | "keep_both") {
  await strata.resolve(id, action);
  revalidatePath("/", "layout");
}

export async function saveNote(
  id: string,
  patch: { name?: string; type?: EntityType; aliases?: string[]; tags?: string[] },
): Promise<{ error?: string }> {
  try {
    await strata.editNote(id, patch);
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function mergeNote(id: string, into: string): Promise<{ error?: string }> {
  try {
    await strata.mergeNote(id, into);
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runRecall(input: {
  query: string;
  maxTokens?: number;
  asOf?: string;
  hops?: number;
}): Promise<{ result?: RecallResult; error?: string }> {
  try {
    return { result: await strata.recall({ ...input, explain: true }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function mergeDuplicates(dryRun: boolean) {
  const r = await strata.mergeDuplicates(dryRun);
  if (!dryRun) revalidatePath("/", "layout");
  return r;
}
