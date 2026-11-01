// The Log Drain's signature check (Node only). Kept apart from request-logs.ts so the Edge middleware can use the
// rest of that module.
import { createHmac, timingSafeEqual } from "node:crypto";

/** x-vercel-signature is the hex HMAC-SHA1 of the raw body with the drain's secret (Vercel Drains security). */
export function verifyDrainSignature(rawBody: Uint8Array | string, header: string | null, secret: string): boolean {
  if (!secret || !header) return false;
  const want = createHmac("sha1", secret).update(rawBody).digest("hex");
  const got = header.trim().toLowerCase();
  if (got.length !== want.length || !/^[0-9a-f]+$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(want, "utf8"));
}
