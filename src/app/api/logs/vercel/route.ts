import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";

import { pgAdmin } from "@/lib/crm/rest";
import { parseDrainBody, rowsFromDrain, verifyDrainSignature } from "@/lib/crm/request-logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vercel's Log Drain for this project: every request the site serves, posted in batches. Each batch is checked
// against VERCEL_LOG_DRAIN_SECRET (x-vercel-signature, HMAC-SHA1 of the raw body) before anything is read, then
// stored as one row per request in request_logs for the owner's security page.
//
// Never a 5xx for a bad line: unreadable lines are skipped. A failed database write is a 503, so Vercel delivers
// the batch again (rows are keyed by request id, so a repeat is not stored twice).

const SECRET = process.env.VERCEL_LOG_DRAIN_SECRET || "";
// Some drain setups ask the endpoint to echo a verification value; set it in Vercel if yours does.
const VERIFY = process.env.VERCEL_LOG_DRAIN_VERIFY || "";
const MAX_BODY = 20_000_000;
const CHUNK = 500;

function withVerify(res: NextResponse): NextResponse {
  if (VERIFY) res.headers.set("x-vercel-verify", VERIFY);
  return res;
}

// Vercel checks the endpoint answers before it starts sending.
export async function GET() {
  return withVerify(NextResponse.json({ ok: true }));
}
export async function HEAD() {
  return withVerify(new NextResponse(null, { status: 200 }));
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return withVerify(new NextResponse("Too large", { status: 413 }));
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY) return withVerify(new NextResponse("Too large", { status: 413 }));
  if (!verifyDrainSignature(raw, request.headers.get("x-vercel-signature"), SECRET)) {
    if (!SECRET) console.error("[log-drain] VERCEL_LOG_DRAIN_SECRET is not set; refusing deliveries");
    return withVerify(NextResponse.json({ code: "invalid_signature" }, { status: 403 }));
  }

  let text: string;
  try {
    const gz = (request.headers.get("content-encoding") ?? "").toLowerCase().includes("gzip") || (raw[0] === 0x1f && raw[1] === 0x8b);
    text = Buffer.from(gz ? gunzipSync(raw, { maxOutputLength: 100_000_000 }) : raw).toString("utf8");
  } catch {
    return withVerify(NextResponse.json({ ok: true, ignored: "unreadable body" }));
  }

  const rows = rowsFromDrain(parseDrainBody(text));
  // Rows that carry a byte count replace an earlier copy of the same request (its first line may have had no
  // size); rows without one never overwrite. Same request id, so the merge only ever adds detail.
  const sized = rows.filter((r) => r.bytes_out !== null);
  const unsized = rows.filter((r) => r.bytes_out === null);
  for (const [group, resolution] of [
    [sized, "merge-duplicates"],
    [unsized, "ignore-duplicates"],
  ] as const) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const outcome = await insertRows(group.slice(i, i + CHUNK), resolution);
      // Only an outage is retried: Vercel resends the batch. A row the database refuses is dropped, never a 5xx.
      if (outcome === "retry") return withVerify(new NextResponse("Try again", { status: 503 }));
    }
  }
  return withVerify(NextResponse.json({ ok: true, stored: rows.length }));
}

type Resolution = "merge-duplicates" | "ignore-duplicates";

async function post(rows: unknown[], resolution: Resolution): Promise<Response | null> {
  return pgAdmin("request_logs?on_conflict=log_key", {
    method: "POST",
    headers: { Prefer: `resolution=${resolution},return=minimal` },
    body: JSON.stringify(rows),
  }).catch(() => null);
}

/**
 * Stores a chunk. On a 4xx (one row the database refuses fails the whole insert) it falls back to one row at a
 * time and drops the rows that still fail, so a single crafted request can't make the log refuse a delivery.
 * "retry" only for a network failure or a database 5xx.
 */
async function insertRows(rows: unknown[], resolution: Resolution): Promise<"ok" | "retry"> {
  if (rows.length === 0) return "ok";
  const res = await post(rows, resolution);
  if (res?.ok) return "ok";
  if (!res || res.status >= 500) {
    console.error("[log-drain] insert failed", res?.status ?? "network", `${rows.length} rows`);
    return "retry";
  }
  let dropped = 0;
  for (const row of rows) {
    const one = await post([row], resolution);
    if (one?.ok) continue;
    if (!one || one.status >= 500) return "retry";
    dropped += 1;
  }
  if (dropped) console.warn("[log-drain] dropped rows the database refused", dropped);
  return "ok";
}
