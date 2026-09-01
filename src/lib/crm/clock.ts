// One place for "what time is it where the work is".
//
// The app runs on Vercel, whose servers are UTC, and it's read on phones set to
// whatever their owners set them to. Neither is the answer to any question this
// business actually asks: a job is on a day in North Carolina, a log line
// happened at a time in North Carolina, and a text lands in somebody's evening
// in North Carolina. So every "today", every clock time on screen and every
// send decision goes through here.
//
// The zone is named rather than pinned to -05:00. "EST" in conversation means
// Eastern, and Eastern is EST for four months of the year and EDT for the other
// eight; a fixed offset would be an hour out all summer, which is exactly the
// kind of bug that only shows up in a month nobody is testing in.
//
// Safe to import from client components: pure Intl, no env, no secrets.

export const BUSINESS_TZ = "America/New_York";

// Quiet hours. Nothing goes out from 7pm until 8am the next morning - not to a
// customer, not to the crew, not to the owner. A text at 9pm is a text that
// wakes somebody up, and none of what this app sends is worth that.
export const QUIET_FROM_HOUR = 19;
export const QUIET_UNTIL_HOUR = 8;

/**
 * The current instant, and the only place the app is allowed to ask for it.
 *
 * Everything time-sensitive - what today is, whether we're inside quiet hours,
 * when a held text is due - reads the clock through here, so there is one thing
 * to reason about, one thing to check against a real time source (see
 * `checkClockDrift` in ./time-check), and one thing to fake if this ever needs
 * testing at 3am.
 *
 * It is the host clock. On Vercel that is an AWS instance kept in step by the
 * platform's own time service, which is accurate to well under a second - far
 * closer than this app needs, given the finest distinction it draws is a
 * one-minute cron tick.
 */
export function now(): Date {
  return new Date();
}

/** An hour of the day as people say it: 19 -> "7pm", 8 -> "8am". */
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

// The wall clock in Raleigh at a given instant.
function partsIn(at: Date): Parts {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(at)) p[type] = value;
  // Some ICU builds render midnight as hour 24 under hour12:false.
  const h = Number(p.hour) % 24;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h, mi: Number(p.minute), s: Number(p.second) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date in Raleigh, as YYYY-MM-DD. */
export function todayYmd(at: Date = now()): string {
  const { y, mo, d } = partsIn(at);
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * A calendar date N days from today in Raleigh, as YYYY-MM-DD. Negative counts
 * back. The arithmetic is done in UTC on a bare date, which has no clocks in it
 * and so can't be knocked an hour sideways by a DST change in the middle.
 */
export function ymdInDays(days: number, at: Date = now()): string {
  const [y, mo, d] = todayYmd(at).split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

// How far the business's zone is from UTC at a given instant, in ms.
function offsetAt(at: Date): number {
  const { y, mo, d, h, mi, s } = partsIn(at);
  // Whole seconds on both sides, so the sub-second part of `at` doesn't leak
  // into an offset that is only ever a whole number of minutes.
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant at which a wall-clock time in Raleigh happens.
 *
 * Guess the offset from the naive UTC reading, then take it again at the
 * corrected instant: the second pass is what gets the two days a year when the
 * guess lands on the far side of a DST change. 8am is never inside the spring
 * gap, so there's no missing-hour case to resolve here.
 */
function instantAt(y: number, mo: number, d: number, h: number, mi: number): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const once = naive - offsetAt(new Date(naive));
  return new Date(naive - offsetAt(new Date(once)));
}

/** Is it currently inside quiet hours in Raleigh? */
export function inQuietHours(at: Date = now()): boolean {
  const { h } = partsIn(at);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/**
 * The next moment a text may go out: right now if we're inside business hours,
 * otherwise 8am - this morning if it's still the small hours, tomorrow morning
 * if the evening has already closed.
 */
export function nextSendableAt(at: Date = now()): Date {
  if (!inQuietHours(at)) return at;
  const { y, mo, d, h } = partsIn(at);
  // Before 8am is still the same Raleigh date; after 7pm rolls to the next one.
  const day = h < QUIET_UNTIL_HOUR ? { y, mo, d } : dayAfter(y, mo, d);
  return instantAt(day.y, day.mo, day.d, QUIET_UNTIL_HOUR, 0);
}

function dayAfter(y: number, mo: number, d: number): { y: number; mo: number; d: number } {
  const t = new Date(Date.UTC(y, mo - 1, d + 1));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * An instant written the way a person here would say it, e.g.
 * "8:00 AM" / "tomorrow at 8:00 AM" - for telling somebody when a held text
 * will actually leave.
 */
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
