import { strata } from "@/lib/strata";

export const dynamic = "force-dynamic";

/** Proxies the API's server-sent events so the API key stays on the server. */
export async function GET(req: Request) {
  try {
    const upstream = await strata.events(req.signal);
    return new Response(upstream.body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
    });
  } catch {
    return new Response("event: offline\ndata: {}\n\n", { status: 503, headers: { "content-type": "text/event-stream" } });
  }
}
