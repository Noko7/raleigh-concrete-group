// Server-only. Signs the storage paths handed to /crm/api/file.
//
// The proxy used to take any object name in the quote-uploads bucket and hand
// it to whoever was signed in. That is authentication without authorization:
// every contractor could read every customer's photos, and the only thing
// actually stopping them was that object names are random. The sibling route
// for signed contracts (/crm/api/agreement) does not work that way - it takes
// an id and re-reads the row through RLS - and this closes the same gap for
// media without a database round-trip per thumbnail.
//
// The page already knows who is looking and which job they are allowed to see,
// because it loaded the job through RLS before it rendered a single <img>. So
// the URL it builds carries that decision: an HMAC over the path, the viewer's
// staff id and an expiry. The route re-computes it from the SESSION's staff id,
// which is what makes a link useless to anybody else - a URL copied out of one
// person's page does not open on another's.
//
// Keyed off the service-role key rather than a new env var. It is server-only
// and already required for the route to read the object at all, so there is no
// configuration to get wrong and no way to end up with signing switched off
// while the proxy still serves files.
import { createHmac, timingSafeEqual } from "node:crypto";

import { SERVICE_KEY } from "./env";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/media-token is server-only and must not be imported from client code.");
}

// The expiry is QUANTIZED, and that is the whole trick.
//
// A signature over `Date.now()` would change on every render, so every page
// load would mint a fresh URL for a photo the browser already had - and the
// proxy's `private, max-age=86400` would never once be hit. That would undo the
// thumbnail work: the grid would re-download every image on every visit.
//
// So the expiry lands on a 6-hour boundary. Inside a window every render of the
// same photo for the same person produces a byte-identical URL, which the
// browser cache recognises; the window then rolls and the old URL stays valid
// long enough that nobody's open tab breaks at the boundary.
const WINDOW_SECONDS = 6 * 60 * 60;
const TTL_SECONDS = 18 * 60 * 60;

// Domain separation: this key signs one kind of thing and must never verify
// something else that happens to hash the same way.
const LABEL = "rcg:media:v1";

function sign(path: string, staffId: string, expires: number): string {
  return createHmac("sha256", SERVICE_KEY)
    .update(`${LABEL}\n${staffId}\n${expires}\n${path}`, "utf8")
    .digest("base64url");
}

/**
 * The query string for one object, scoped to one viewer.
 *
 * Returns `p`, `e` and `s` - the width is deliberately NOT signed, so the same
 * signature serves the 150px thumbnail in the grid and the full-size original
 * the lightbox opens.
 */
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

/**
 * Is this signature ours, for this viewer, and still in date?
 *
 * Fails closed on everything: a missing key, a missing or malformed parameter,
 * an expiry that has passed, a signature of the wrong length. Compared in
 * constant time - a plain === leaks how much of the signature was right
 * through how long it took to say no.
 */
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
