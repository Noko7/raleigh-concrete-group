// Guards the cron routes. Server-only (reads CRON_SECRET). Constant-time compare: === leaks how much of
// the secret matched.
import { timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/cron-auth is server-only and must not be imported from client code.");
}

/**
 * Vercel Cron sends the secret as a Bearer token; anything else is a no, in constant time.
 * Fails CLOSED when CRON_SECRET is unset: these routes text customers and crew.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const header = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(header, "utf8");

  // timingSafeEqual throws on length mismatch. Leaks only the length, not the contents.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
