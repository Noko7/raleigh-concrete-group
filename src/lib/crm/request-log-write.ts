// The site logs its own traffic (Vercel's Log Drains aren't available on this plan): the middleware records every
// page and API request (IP, method, path, user agent, probe tag), and the routes that can hand out data in bulk
// (PDFs, the CSV export, file and agreement downloads) add the size of what they sent. Both write the same row,
// keyed by Vercel's per-request id (x-vercel-id), so a download is one request with its byte count, not two.
//
// Edge-safe (fetch only): used from middleware.ts and from Node route handlers. Never throws, never delays the
// response (callers hand the promise to waitUntil / don't await it on the hot path).
import { after } from "next/server";

import { selfLogRow, type SelfLogInput } from "./request-log-row";

export { clientIpOf, requestKey, selfLogRow, type SelfLogInput } from "./request-log-row";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Store a request. The middleware's row never overwrites (ignore-duplicates); a route's row, which knows the
 * status and bytes sent, fills them in (merge-duplicates). Failures are swallowed: logging must never break a page.
 */
export async function writeSelfLog(i: SelfLogInput): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  const row = selfLogRow(i);
  const merge = i.source === "app";
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/request_logs?on_conflict=log_key`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: `resolution=${merge ? "merge-duplicates" : "ignore-duplicates"},return=minimal`,
      },
      body: JSON.stringify([row]),
    });
  } catch {
    // never break the request over logging
  }
}

/**
 * For a route that can send data in bulk: logs the size of what it actually sent and returns the response. With a
 * Content-Length that is the size; otherwise the body is counted as it streams out (nothing is buffered). The row
 * is written after the response has finished, so the download is never delayed.
 */
export function logDataOut(request: Request, response: Response): Response {
  try {
    const base = { headers: request.headers, method: request.method, url: request.url, status: response.status, source: "app" as const };
    const declared = Number(response.headers.get("content-length"));
    if (!response.body || (Number.isFinite(declared) && declared > 0)) {
      const bytes = Number.isFinite(declared) && declared > 0 ? declared : 0;
      after(() => writeSelfLog({ ...base, bytesOut: bytes }));
      return response;
    }
    let bytes = 0;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => (finish = resolve));
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        finish();
      },
    });
    // Also settle if the client walks away mid-download, so the partial count is still logged.
    const body = response.body.pipeThrough(counter);
    after(async () => {
      await Promise.race([done, new Promise((r) => setTimeout(r, 25_000))]);
      await writeSelfLog({ ...base, bytesOut: bytes });
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    return response;
  }
}
