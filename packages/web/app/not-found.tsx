import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-lg font-semibold">Not in memory</h1>
      <p className="mt-2 text-muted">This note or source doesn't exist. It may have been merged into another note or forgotten.</p>
      <Link href="/notes" className="mt-5 inline-block text-ochre hover:underline">
        All notes
      </Link>
    </div>
  );
}
