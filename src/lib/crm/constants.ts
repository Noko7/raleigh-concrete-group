// Safe to import from client components (no secrets).

// Flat credit offered when a customer goes to decline a quote, in dollars.
export const DECLINE_CREDIT = 150;

// Lives here, not in queries.ts, because the crew's client-side card counts against it while typing.
export const CHANGE_NOTE_MAX = 600;

// Pipeline:
//   New       lead, no quote sent
//   Quoted    waiting on the customer
//   Approved  customer said yes with preferred days; needs a confirmed date
//   Scheduled work day confirmed
//   Completed work done on site
//   Paid      money received
//   Lost      declined or dead
export const STATUSES = ["new", "quoted", "approved", "scheduled", "completed", "paid", "lost"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  quoted: "Quoted",
  approved: "Needs scheduling",
  scheduled: "Scheduled",
  completed: "Completed",
  paid: "Paid",
  lost: "Lost",
};

// Seven-day floor on customer-requested install days: time to line up crew and materials.
export const MAX_PREFERRED_DATES = 3;
export const LEAD_TIME_DAYS = 7;

// Shorter than the install lead: a visit is one person for an hour, not a crew and a truck.
export const VISIT_LEAD_DAYS = 4;

// Age before the contractor gets the one-time "lead needs attention" text. 48h because leads often land
// while the crew is on a job.
export const STALE_LEAD_HOURS = 48;

// Days after a site visit before the lead needs attention again.
export const VISIT_GRACE_DAYS = 2;

// Minimum gap between visit START times for one contractor (a drive across Raleigh). A gap rather than
// fixed slots, so an odd booked time like 9:30 blocks both 9:00 and 10:00.
export const VISIT_GAP_MINUTES = 60;

// WORK days stay one per day for the whole business; only visits stack.

// Defaults until the contractor sets Working hours. Both are slot START hours, so 8..16 is 8:00 AM to 4:00 PM.
export const DEFAULT_WORK_START_HOUR = 8;
export const DEFAULT_WORK_END_HOUR = 16;
// Rails on typed hours so a typo can't offer a 3am appointment.
export const WORK_HOUR_MIN = 5;
export const WORK_HOUR_MAX = 21;

// 0=Sunday..6=Saturday, matching Date#getUTCDay.
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type WorkHours = { startHour: number; endHour: number; days: number[] };

// All seven days: the preference starts unrestricted and only narrows when someone sets it.
export const DEFAULT_WORK_HOURS: WorkHours = {
  startHour: DEFAULT_WORK_START_HOUR,
  endHour: DEFAULT_WORK_END_HOUR,
  days: [0, 1, 2, 3, 4, 5, 6],
};

const clampHour = (n: unknown, fallback: number): number => {
  const h = Math.round(Number(n));
  return Number.isFinite(h) && h >= WORK_HOUR_MIN && h <= WORK_HOUR_MAX ? h : fallback;
};

/**
 * Every caller reads working hours through here: columns are nullable on old rows, the form accepts
 * anything, and end before start would produce a day with no slots.
 */
export function readWorkHours(
  raw?: { work_start_hour?: number | null; work_end_hour?: number | null; work_days?: number[] | null } | null,
): WorkHours {
  if (!raw) return DEFAULT_WORK_HOURS;
  const startHour = clampHour(raw.work_start_hour, DEFAULT_WORK_START_HOUR);
  const endHour = Math.max(startHour, clampHour(raw.work_end_hour, DEFAULT_WORK_END_HOUR));
  const days = Array.isArray(raw.work_days)
    ? [...new Set(raw.work_days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  // No days ticked = no restriction, not "never available" (which would strand the contractor's leads).
  return { startHour, endHour, days: days.length > 0 ? days : DEFAULT_WORK_HOURS.days };
}

/** "9:00 AM" -> 540 minutes past midnight. Null on anything we didn't write. */
export function minutesOfTime(t?: string | null): number | null {
  const m = (t ?? "").trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return null;
  const h = Number(m[1]) % 12;
  const min = Number(m[2]);
  if (Number(m[1]) > 12 || min > 59) return null;
  return (m[3].toUpperCase() === "PM" ? h + 12 : h) * 60 + min;
}

/** 9 -> "9:00 AM", 13 -> "1:00 PM", in the format TIME_RE expects. */
export function hourSlot(h: number): string {
  return `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
}

export function slotsFor(w: WorkHours): string[] {
  const out: string[] = [];
  for (let h = w.startHour; h <= w.endHour; h += 1) out.push(hourSlot(h));
  return out;
}

/** Shown before a date (and so a contractor) is picked. */
export const DEFAULT_VISIT_SLOTS = slotsFor(DEFAULT_WORK_HOURS);

/**
 * Weekday of a YYYY-MM-DD, 0=Sunday, read in UTC: `new Date("2026-03-08")` is midnight UTC, the evening
 * of the 7th in Raleigh, so a local weekday would be a day early.
 */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function worksOn(w: WorkHours, ymd: string): boolean {
  return w.days.includes(weekdayOf(ymd));
}

// Every stored time is "H:MM AM/PM". Validates scheduled_time/visit_time regardless of slot list.
export const TIME_RE = /^\d{1,2}:\d{2}\s?(AM|PM)$/i;

// Native <input type="time"> value (24h "HH:MM") to "H:MM AM/PM".
export function to12Hour(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const h24 = Number(m[1]);
  const ap = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
export function to24Hour(t: string, fallback = "09:00"): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return fallback;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

// Every quote answers these five, in this order (the customer page and both editors). Skipped permits or
// cleanup is where disputes start, so the shape is fixed.
export const QUOTE_SECTION_FIELDS = [
  "quote_scope",
  "quote_permits",
  "quote_prep",
  "quote_pour",
  "quote_cleanup",
] as const;
export type QuoteSectionField = (typeof QUOTE_SECTION_FIELDS)[number];

export const QUOTE_SECTION_LABELS: Record<QuoteSectionField, string> = {
  quote_scope: "Scope",
  quote_permits: "Permits",
  quote_prep: "Demolition and prep",
  quote_pour: "Pour and finish",
  quote_cleanup: "Clean up",
};

// Placeholder text. Short: read on a phone on a job site.
export const QUOTE_SECTION_HINTS: Record<QuoteSectionField, string> = {
  quote_scope: "What we're building, the size, and the finish.",
  quote_permits: "Who pulls them, the fee as its own line item, or Not applicable.",
  quote_prep: "What comes out, what gets hauled away, how the base is built.",
  quote_pour: "Depth, reinforcement, concrete mix, and the finish.",
  quote_cleanup: "How the site is left, and when.",
};

// Long enough to think it over and collect other quotes; short enough that the price isn't held while
// material costs move. An unanswered quote moves to Lost when it runs out (expire_unanswered_quotes(), every
// 5 minutes); resending revives it with a fresh QUOTE_TTL_DAYS.
export const QUOTE_TTL_DAYS = 30;

/**
 * Quote amounts are in DOLLARS. Ledger figures are cents and use `usd()` in ./fees; mixing them is a 100x
 * error. Cents shown only when present ($950, $8,250.50); bare toLocaleString gives "$8,250.5".
 */
export function dollars(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A quote amount in DOLLARS as money, "$0" when there is none. Not ./fees `usd`, which takes cents. */
export function dollarsOrZero(n: number): string {
  return dollars(n) ?? "$0";
}

/** Dollars as typed by a person - "$4,000", " 4000.50 " - with the "$", commas and spaces taken out. */
export function cleanAmount(raw: unknown): string {
  return String(raw ?? "").replace(/[$,\s]/g, "");
}

/** cleanAmount, as a number. "" is 0 and junk is NaN, so each caller decides what it accepts. */
export function parseDollars(raw: unknown): number {
  return Number(cleanAmount(raw));
}

/** The first word of a name, or `fallback` when there is none. */
export function firstNameOf(full: string, fallback: string): string {
  return full.trim().split(/\s+/)[0] || fallback;
}

// No em dashes in customer-facing text (applied to every outbound text and quote body on save): they read
// as not written by the sender and render inconsistently. Also folds en dashes and "--".
export function noEmDash(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s--\s/g, " - ");
}

// How a job is priced, which decides whether anyone visits:
//   inperson  we measure on site; the only kind with a real appointment
//   online    priced from photos; the customer offers a fallback slot, nobody is committed to it
//   plans     priced from drawings (commercial); no visit, no photos
// null predates the column and is treated as in-person.
export const QUOTE_TYPES = ["inperson", "online", "plans"] as const;
export type QuoteType = (typeof QUOTE_TYPES)[number];

export const QUOTE_TYPE_LABELS: Record<QuoteType, string> = {
  inperson: "In person",
  online: "Online (photos)",
  plans: "From plans",
};

// visit_date means two things depending on quote_type; anything that shows a date to a person reads it
// through one of these two.
type Visitable = { quote_type?: string | null; visit_date?: string | null };

// A booked appointment (calendar, Google invites, crew reminders, job page date). In-person only.
// An allow-list so a new type like 'plans' can't claim a visit nobody booked.
export function visitDateOf(q: Visitable): string | null {
  const booked = q.quote_type === "inperson" || q.quote_type == null;
  return booked ? (q.visit_date ?? null) : null;
}

// An online customer's fallback slot: an option, not a commitment. Confirming it turns the quote
// in-person, after which it reads as a real visit above.
export function requestedVisitOf(q: Visitable): string | null {
  return q.quote_type === "online" ? (q.visit_date ?? null) : null;
}

// Days before a booked job the crew gets a reminder; 0 is the morning of (cron runs ~10am ET).
export const CREW_REMINDER_DAYS = [3, 1, 0];

// Line items. A quote with none is a single-price quote.
//   required  part of the job; shown, but not the customer's to drop
//   optional  an extra; they say yes or no and the total follows
export const MAX_QUOTE_OPTIONS = 12;
export const OPTION_TITLE_MAX = 120;
export const OPTION_DESC_MAX = 2000;

// Ids are absent on unsaved rows.
export type QuoteOptionDraft = {
  id?: string;
  title: string;
  description: string;
  amount: number;
  required: boolean;
};

type Priced = { amount: number | string | null };
export const optionAmount = (o: Priced): number => {
  const n = Number(o.amount);
  return Number.isFinite(n) ? n : 0;
};

// Total if the customer takes everything: the figure a quote carries before anyone answers.
export function optionsTotal(rows: Priced[]): number {
  return Math.round(rows.reduce((sum, o) => sum + optionAmount(o), 0) * 100) / 100;
}

// Required items plus optional ones answered yes. Missing answers count as not chosen, so a half-answered
// quote reads low rather than high.
export function selectedTotal(
  rows: (Priced & { id: string; required: boolean })[],
  answers: Record<string, "accepted" | "declined" | undefined>,
): number {
  return optionsTotal(rows.filter((o) => o.required || answers[o.id] === "accepted"));
}

// A change order starts from what the customer actually bought: required lines plus accepted extras.
export type ChangeLineDraft = { title: string; description: string | null; amount: number };

export function boughtLines(
  options: { title: string; description: string | null; amount: number | string; required: boolean; customer_response: string | null }[],
): ChangeLineDraft[] {
  return options
    .filter((o) => o.required || o.customer_response === "accepted")
    .map((o) => ({ title: o.title, description: o.description || null, amount: optionAmount(o) }));
}

// A change is nearly always "same job, plus this". A one-price job starts with one line carrying its
// agreed total, so an added line adds money instead of becoming the whole new price.
export function changeStartLines(
  bought: ChangeLineDraft[],
  agreedTotal: number | string | null,
  service: string | null,
): ChangeLineDraft[] {
  if (bought.length > 0) return bought;
  const amount = optionAmount({ amount: agreedTotal });
  if (amount <= 0) return [];
  const what = (service ?? "").trim();
  return [{ title: (what ? `${what}, as approved` : "Original job, as approved").slice(0, OPTION_TITLE_MAX), description: null, amount }];
}

export function sameChangeLines(a: ChangeLineDraft[], b: ChangeLineDraft[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.title === b[i].title &&
        (x.description || "") === (b[i].description || "") &&
        Number(x.amount) === Number(b[i].amount),
    )
  );
}

// Packages answer "or instead" (concrete OR asphalt driveway); the customer picks exactly one and line
// items apply on top. Separate from line items because two selected packages is a contradiction.
export const MAX_QUOTE_PACKAGES = 4;
// A single package is a quote in progress: kept so a save mid-thought isn't lost, but it prices nothing
// and the send is refused.
export const MIN_QUOTE_PACKAGES = 2;
export const isChoice = (packages: { length: number }): boolean => packages.length >= MIN_QUOTE_PACKAGES;
export const PACKAGE_TITLE_MAX = 120;
export const PACKAGE_DESC_MAX = 2000;

// Letters, not numbers, so nothing reads as a ranking.
export const packageLetter = (i: number): string => String.fromCharCode(65 + (i % 26));

// Ids are absent on unsaved packages.
export type QuotePackageDraft = {
  id?: string;
  title: string;
  description: string;
  amount: number;
  recommended: boolean;
};

// Recommended, else first: the headline figure for a quote that offers a choice.
export function leadPackage<T extends { recommended: boolean }>(rows: T[]): T | null {
  if (!isChoice(rows)) return null;
  return rows.find((p) => p.recommended) ?? rows[0] ?? null;
}

// `chosen` is null on a quote with no packages; the result then equals selectedTotal.
export function quoteTotal(
  chosen: Priced | null,
  rows: (Priced & { id: string; required: boolean })[],
  answers: Record<string, "accepted" | "declined" | undefined>,
): number {
  const base = chosen ? optionAmount(chosen) : 0;
  return Math.round((base + selectedTotal(rows, answers)) * 100) / 100;
}

// Headline figure before anyone has chosen: the lead package plus everything else.
export function allInTotal(packages: (Priced & { recommended: boolean })[], rows: Priced[]): number {
  const lead = leadPackage(packages);
  return Math.round(((lead ? optionAmount(lead) : 0) + optionsTotal(rows)) * 100) / 100;
}
