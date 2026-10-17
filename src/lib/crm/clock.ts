// Every "today", on-screen time and send decision goes through here, in North Carolina time: servers are
// UTC and phones are set to anything.
// A named zone, not -05:00: Eastern is EDT eight months a year. Client-safe (pure Intl).

export const BUSINESS_TZ = "America/New_York";

// Quiet hours: nothing goes out from 7pm to 8am, to anyone.
export const QUIET_FROM_HOUR = 19;
export const QUIET_UNTIL_HOUR = 8;

/**
 * The only place the app reads the current instant (one thing to check, see checkClockDrift, and to fake
 * in tests). The Vercel host clock is accurate to well under a second; the finest distinction drawn is a
 * one-minute cron tick.
 */
export function now(): Date {
  return new Date();
}

/** 19 -> "7pm", 8 -> "8am". */
export function hourLabel(h: number): string {
  return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function partsIn(at: Date): Parts {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(at)) p[type] = value;
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const h = Number(p.hour) % 24;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h, mi: Number(p.minute), s: Number(p.second) };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function todayYmd(at: Date = now()): string {
  const { y, mo, d } = partsIn(at);
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Negative counts back. Arithmetic on a bare UTC date, so a DST change can't shift it. */
export function ymdInDays(days: number, at: Date = now()): string {
  const [y, mo, d] = todayYmd(at).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

// In ms.
function offsetAt(at: Date): number {
  const { y, mo, d, h, mi, s } = partsIn(at);
  // Whole seconds on both sides so `at`'s sub-second part doesn't leak into a whole-minute offset.
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Guess the offset from the naive UTC reading, then take it again at the corrected instant: the second
 * pass handles a guess on the far side of a DST change. 8am is never in the spring gap.
 */
function instantAt(y: number, mo: number, d: number, h: number, mi: number): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const once = naive - offsetAt(new Date(naive));
  return new Date(naive - offsetAt(new Date(once)));
}

export function inQuietHours(at: Date = now()): boolean {
  const { h } = partsIn(at);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** Now if inside business hours, else 8am (this morning or tomorrow). */
export function nextSendableAt(at: Date = now()): Date {
  if (!inQuietHours(at)) return at;
  const { y, mo, d, h } = partsIn(at);
  // Before 8am is still the same Raleigh date; after 7pm rolls to the next.
  const day = h < QUIET_UNTIL_HOUR ? { y, mo, d } : dayAfter(y, mo, d);
  return instantAt(day.y, day.mo, day.d, QUIET_UNTIL_HOUR, 0);
}

function dayAfter(y: number, mo: number, d: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(y, mo - 1, d + 1));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** E.g. "8:00 AM" / "tomorrow at 8:00 AM", for when a held text will leave. */
export function clockLabel(at: Date, asOf: Date = now()): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  const days = daysApart(todayYmd(asOf), todayYmd(at));
  if (days === 0) return time;
  if (days === 1) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, month: "long", day: "numeric" }).format(at)} at ${time}`;
}

function daysApart(fromYmd: string, toYmd: string): number {
  const [ay, am, ad] = fromYmd.split("-").map(Number);
  const [by, bm, bd] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
