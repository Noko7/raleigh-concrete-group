// Server-only clock-drift check. Reports only; never sets the clock (time comes from `now()` in ./clock).
// Not NTP: Vercel functions get outbound TCP only (no UDP/123), and the host clock (Amazon Time Sync) is
// already better than a public pool. Instead, compare against an HTTPS Date header: no key, one HEAD
// request, accurate to the second, which is all quiet hours need.
import { BUSINESS_TZ, now } from "./clock";

// Cloudflare's is the same anycast network as time.cloudflare.com NTP; the others cover it being unreachable.
const TIME_HOSTS = ["https://time.cloudflare.com/", "https://www.google.com/generate_204", "https://api.github.com/"];

export type ClockCheck = {
  ok: boolean;
  /** Seconds; + means our clock is ahead. */
  driftSeconds?: number;
  source?: string;
  ours?: string;
  error?: string;
};

// Date headers are whole seconds and the request takes time; past a minute, quiet hours run on the wrong clock.
export const DRIFT_TOLERANCE_SECONDS = 60;

export async function checkClockDrift(): Promise<ClockCheck> {
  let lastError = "";

  for (const host of TIME_HOSTS) {
    try {
      const before = now().getTime();
      // Any response with a Date header will do, including a 403.
      // Capped: an unreachable host otherwise hangs until the platform gives up, and Settings waits on it.
      const res = await fetch(host, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(2500) });
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
      // Compare against the request midpoint so round-trip time isn't counted as drift.
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
