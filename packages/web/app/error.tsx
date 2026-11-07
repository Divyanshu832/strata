"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const offline = /fetch failed|ECONNREFUSED|API key/i.test(error.message);
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <h1 className="text-lg font-semibold">{offline ? "Can't reach the Strata API" : "This page failed to load"}</h1>
      <p className="mt-2 text-muted">
        {offline
          ? "Start it with `pnpm dev` from the repo root, and check STRATA_URL and STRATA_API_KEY in .env."
          : error.message}
      </p>
      <button onClick={reset} className="mt-5 rounded-md bg-ochre px-3 py-1.5 text-[13px] font-medium text-sunk">
        Try again
      </button>
    </div>
  );
}
