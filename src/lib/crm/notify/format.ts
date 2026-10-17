// Internal text helpers shared by the ./notify modules: business constants,
// line formatting, dates. Only ChosenOption is re-exported from ../notify.ts.
import { phoneDisplay } from "@/lib/site-data";
import { firstNameOf, dollars, visitDateOf } from "../constants";

// Used only in the FIRST text a customer gets. After that the business speaks,
// since anyone may pick up the phone.
export const OWNER_NAME = (process.env.OWNER_NAME || "Noah").trim();
// Google review link for the job-complete thank-you; env overrides without a deploy.
export const REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || "https://g.page/r/Cf1V-s7AJLEaEAI/review").trim();
export const BUSINESS = "Raleigh Concrete Group";

// Opt-out notice: only in the FIRST message to someone; repeating it trains
// people to skip it. STOP works on every message regardless, since the carrier
// and provider handle it before it reaches us.
export const OPT_OUT_LINE = "Reply STOP any time to stop these texts.";
// Number the crew call when they can't make it. Defaults to site-data's main
// line, so the digits live in one place.
export const CALL_NUMBER = (process.env.OWNER_CALL_NUMBER || phoneDisplay).trim();

// Messages are built from lines, not sentences: the crew read these on site.
// `block("Label:", value)` is the shape throughout: label, value, blank.
export function block(label: string, ...values: (string | null | undefined)[]): string[] {
  const clean = values.filter((v): v is string => Boolean(v && v.trim()));
  return clean.length ? [label, ...clean, ""] : [];
}

// Joins lines and collapses blank runs, so an omitted block leaves no gap.
export function text(lines: (string | null | undefined)[]): string {
  return lines
    .filter((l): l is string => l !== null && l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type QuoteInfo = {
  // For logging against the job. Optional: a few texts precede a job.
  id?: string | null;
  name: string;
  phone: string;
  service?: string | null;
  address?: string | null;
  details?: string | null;
  quote_type?: string | null;
  quote_amount?: number | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  preferred_dates?: string[] | null;
  // Start time per preferred date, index-aligned. Entries may be null.
  preferred_times?: (string | null)[] | null;
  visit_date?: string | null;
  visit_time?: string | null;
  public_token?: string;
  job_token?: string;
  // What the customer said yes/no to on an itemised quote. Only on texts sent
  // as they answer.
  chosen?: { accepted: ChosenOption[]; declined: ChosenOption[] } | null;
};

export type ChosenOption = { title: string; amount: number };

export const firstName = (full: string) => firstNameOf(full, "there");
// PRICE NEVER GOES IN A CUSTOMER TEXT. A bare figure has no scope beside it and
// gets forwarded and shopped around; the quote page shows it in context, and
// texts carry the link. `usd` is for "owner" and "crew" roles only.
export const usd = (n?: number | null) => dollars(n);

// 1st, 2nd, 3rd, 4th...
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

// "Friday, August 29th", or null when there's no date, so a crew text never
// says "your scheduled day" for an unbooked job.
export function dayOrNull(ymd?: string | null): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00`);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${ordinal(d.getDate())}`;
}

export function prettyDay(ymd?: string | null): string {
  return dayOrNull(ymd) ?? "your scheduled day";
}

// Customer block for crew texts. One field per line rather than label blocks,
// which would push a reminder past four SMS segments. Absent fields are omitted.
export function customerBrief(q: QuoteInfo): string {
  const lines = [`Customer: ${q.name}`, `Phone: ${q.phone}`];
  if (q.service?.trim()) lines.push(`Service: ${q.service.trim()}`);
  if (q.address?.trim()) lines.push(`Address: ${q.address.trim()}`);

  const jobDay = dayOrNull(q.scheduled_date);
  const visitDay = dayOrNull(visitDateOf(q));
  if (jobDay) lines.push(`Scheduled: ${jobDay}${q.scheduled_time ? ` at ${q.scheduled_time}` : ""}`);
  else if (visitDay) lines.push(`Quote visit: ${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}`);
  else lines.push("Scheduled: not yet");

  return lines.join("\n");
}

// "Monday, August 17 at 9:00 AM". Every customer mention of the appointment
// uses this, so the time can't drop out of one message only.
export function dayAndTime(q: QuoteInfo): string {
  return `${prettyDay(q.scheduled_date)}${q.scheduled_time ? ` at ${q.scheduled_time}` : ""}`;
}
