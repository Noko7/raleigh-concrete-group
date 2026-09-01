// Server-only: is the clock this app runs on actually telling the truth?
//
// WHY THIS IS NOT NTP
//
// The obvious way to answer that is to ask an NTP server - us.pool.ntp.org and
// friends - and that isn't available to us here. NTP is UDP on port 123, and
// this app runs as Vercel serverless functions, which get outbound TCP and
// nothing else: a dgram socket either throws or hangs there. It's not a library
// we're missing, it's a socket type the platform doesn't hand out.
//
// It also wouldn't buy anything. Vercel runs on AWS instances whose clocks are
// disciplined by the Amazon Time Sync Service - a local NTP/PTP source on the
// hypervisor, accurate to well under a millisecond and far steadier than what
// a public pool server would give us over the open internet. The host clock is
// already the good clock. Re-deriving time in userland from a pool server we
// reach across the internet would make it less accurate, not more, and would
// put a network round trip (and a new way to fail) in front of every date this
// app renders.
//
// What can go wrong is worth checking anyway, so this is the check: ask a
// well-known HTTPS host what time it thinks it is and compare. The Date header
// is a required part of every HTTP response, it costs one HEAD request, it
// needs no API key, and it's accurate to the second - which is the resolution
// that matters here, where the finest distinction the app draws is "before 8am
// or after". Nothing depends on this call: it reports, it never sets the clock.
// Time itself comes from `now()` in ./clock, the one place that reads it.
import { BUSINESS_TZ, now } from "./clock";

// Cloudflare's is the closest thing to the ask: the same anycast network that
// answers time.cloudflare.com over NTP, reached over TCP instead. The others
// are there so one host being unreachable isn't the same as "we don't know".
const TIME_HOSTS = ["https://time.cloudflare.com/", "https://www.google.com/generate_204", "https://api.github.com/"];

export type ClockCheck = {
  ok: boolean;
  /** How far ahead (+) or behind (-) our clock is, in seconds. */
  driftSeconds?: number;
  source?: string;
  /** Our own clock, as a person here would read it. */
  ours?: string;
  error?: string;
};

// A second either way is measurement noise: the Date header is whole seconds,
// and the response spent real time in flight. Past a minute something is wrong
// with the host, and quiet hours would be running against the wrong clock.
export const DRIFT_TOLERANCE_SECONDS = 60;

export async function checkClockDrift(): Promise<ClockCheck> {
  let lastError = "";

  for (const host of TIME_HOSTS) {
    try {
      const before = now().getTime();
      // Any answer with a Date header will do, including a refusal: an edge
      // network's 403 is stamped by the same clock its 200s are.
      const res = await fetch(host, { method: "HEAD", cache: "no-store" });
      const after = now().getTime();
      const header = res.headers.get("date");
      if (!header) {
        lastError = `${host} answered without a Date header`;
        continue;
      }
      const theirs = new Date(header).getTime();
      if (Number.isNaN(theirs)) {
        lastError = `${host} sent an unreadable date: "${header}"`;
        continue;
      }
      // Compare against the middle of the request rather than either end, so
      // the round trip is split between the two instead of counted as drift.
      const ours = (before + after) / 2;
      return {
        ok: true,
        driftSeconds: Math.round((ours - theirs) / 100) / 10,
        source: new URL(host).host,
        ours: new Intl.DateTimeFormat("en-US", {
          timeZone: BUSINESS_TZ,
          dateStyle: "medium",
          timeStyle: "long",
        }).format(new Date(ours)),
      };
    } catch (e) {
      lastError = `${host}: ${String(e).slice(0, 200)}`;
    }
  }

  return { ok: false, error: lastError || "No time source could be reached." };
}
