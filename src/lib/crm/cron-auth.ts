// The one check standing between Vercel Cron and anybody who has guessed a
// route name. Server-only: it reads CRON_SECRET.
//
// Was three copies of the same four lines, one per cron route, each comparing
// with `===`. Two problems with that, and the duplication is the smaller one:
// a plain string compare on a secret returns as soon as it finds a byte that
// differs, so how long it takes to say no is a function of how much of the
// secret was right. verifyWebhook in stripe.ts already does this properly, and
// there was no reason for the crons to be the exception.
import { timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/cron-auth is server-only and must not be imported from client code.");
}

/**
 * Did this request come from our scheduler?
 *
 * Vercel Cron sends the secret as a Bearer token. Anything else - a missing
 * header, a wrong scheme, a near-miss - is a no, and every no costs the same
 * amount of time.
 *
 * Fails CLOSED when CRON_SECRET is unset. An unset secret is a misconfigured
 * deploy, and the safe reading of it is "nobody may run the crons" rather than
 * "everybody may": these routes text customers and the crew.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const header = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(header, "utf8");

  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first. That does leak the LENGTH of the secret, which is not a secret worth
  // protecting - the contents are, and those are compared in constant time.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
