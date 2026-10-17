// Server-only. Signs storage paths for /crm/api/file so a signed-in user can only open media for jobs the
// page already loaded for them through RLS (authorization, not just authentication), without a DB
// round-trip per thumbnail.
// The HMAC covers the path, viewer's staff id and expiry; the route recomputes it from the SESSION's staff
// id, so a copied URL doesn't open for anyone else.
// Keyed off the service-role key: already required to read the object, so signing can't be switched off
// while the proxy still serves files.
import { createHmac, timingSafeEqual } from "node:crypto";

import { SERVICE_KEY } from "./env";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/media-token is server-only and must not be imported from client code.");
}

// The expiry is QUANTIZED to 6-hour windows so repeat renders produce byte-identical URLs and hit the
// proxy's `max-age=86400` cache; a signature over Date.now() would re-download every image each visit.
// The old URL stays valid past the boundary so open tabs don't break.
const WINDOW_SECONDS = 6 * 60 * 60;
const TTL_SECONDS = 18 * 60 * 60;

// Domain separation: this key must never verify something else that hashes the same way.
const LABEL = "rcg:media:v1";

function sign(path: string, staffId: string, expires: number): string {
  return createHmac("sha256", SERVICE_KEY)
    .update(`${LABEL}\n${staffId}\n${expires}\n${path}`, "utf8")
    .digest("base64url");
}

/** Returns `p`, `e` and `s`. Width is deliberately NOT signed, so one signature serves thumbnail and original. */
export function signMediaPath(path: string, staffId: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expires = Math.floor(nowSeconds / WINDOW_SECONDS) * WINDOW_SECONDS + TTL_SECONDS;
  const params = new URLSearchParams({
    p: path,
    e: String(expires),
    s: sign(path, staffId, expires),
  });
  return params.toString();
}

/** Fails closed on everything (missing key or param, expired, wrong length). Constant-time compare. */
export function verifyMediaPath(
  path: string,
  expiresRaw: string | null,
  signature: string | null,
  staffId: string,
): boolean {
  if (!SERVICE_KEY || !path || !expiresRaw || !signature || !staffId) return false;

  const expires = Number(expiresRaw);
  if (!Number.isSafeInteger(expires) || expires <= 0) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;

  const expected = Buffer.from(sign(path, staffId, expires), "utf8");
  const given = Buffer.from(signature, "utf8");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
