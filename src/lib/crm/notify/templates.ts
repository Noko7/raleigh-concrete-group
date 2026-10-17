// Server-only SMS notifications: links and message templates. Never import from a client component.
// Re-exported from ../notify.ts, whose header documents the provider settings.
import { STALE_LEAD_HOURS, visitDateOf } from "../constants";
import { SITE_ORIGIN } from "../env";
import {
  BUSINESS,
  CALL_NUMBER,
  block,
  text,
  type QuoteInfo,
  firstName,
  dayOrNull,
  customerBrief,
  dayAndTime,
} from "./format";

export function jobLink(token: string): string {
  return `${SITE_ORIGIN}/job/${token}`;
}
export function quoteLink(token: string): string {
  return `${SITE_ORIGIN}/q/${token}`;
}
export function confirmLink(token: string): string {
  return `${SITE_ORIGIN}/confirm/${token}`;
}
// The customer's payment page. Same token and link for the life of the job, so
// it can be re-sent any time.
export function payLink(token: string): string {
  return `${SITE_ORIGIN}/pay/${token}`;
}

// ── 1. New quote in: text the owner(s) and the auto-assigned contractor ─────
// The owner's version uses labelled blocks so name and number scan at a glance.
export function newQuoteMessage(q: QuoteInfo): string {
  // Free text from the customer; capped so one alert isn't a ten-part text.
  const raw = q.details?.trim();
  const details = raw ? (raw.length > 400 ? `${raw.slice(0, 400)}…` : raw) : null;
  // Raw visit_date, not visitDateOf: an online request's fallback slot is shown
  // too, and the label below says which it is.
  const visitDay = dayOrNull(q.visit_date);

  return text([
    ...block("New Quote Request for:", q.name),
    ...block("Job Type:", q.service?.trim() || "Not specified"),
    ...block("Customer Phone:", q.phone),
    ...block("Address:", q.address?.trim()),
    // Quote type decides the next step: desk work (online) or a drive (in person).
    // Omitted when unset.
    ...block(
      "Quote Type:",
      q.quote_type === "online"
        ? "Online - price it from the photos"
        : q.quote_type === "plans"
          ? "From plans - no visit, price it off the drawings"
          : q.quote_type === "inperson"
            ? "In person"
            : null,
    ),
    // On an online request the date is only the customer's fallback slot, and
    // the label must say nobody agreed to it, or the crew drive out on a maybe.
    // Plans jobs have no date, so the block drops out.
    ...block(
      q.quote_type === "online" ? "If a visit is needed, they asked for:" : "Visit Booked:",
      q.quote_type === "plans"
        ? null
        : visitDay
          ? `${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}${
              q.quote_type === "online" ? " (not confirmed - confirm it on the job page)" : ""
            }`
          : // In person with no time (skipped, or it had passed): the lead was
            // saved anyway, so the next step is the reader's.
            q.quote_type === "inperson"
            ? "Not booked yet - call or text them to set a time"
            : null,
    ),
    ...block("Details:", details),
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

// ── 10. Crew reminders ahead of a booked job ────────────────────────────────
// 3 days out, 1 day out and the morning of. Each repeats address, start time and
// who to call, so a no-show is flagged while there's still time to cover it.
export function crewReminderMessage(q: QuoteInfo, daysOut: number, contractorName?: string | null): string {
  const when = daysOut === 0 ? "TODAY" : daysOut === 1 ? "TOMORROW" : `IN ${daysOut} DAYS`;
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";

  return text([
    `JOB REMINDER: ${when}`,
    "",
    greeting,
    "you're scheduled for this job:",
    "",
    ...block("When:", dayAndTime(q)),
    customerBrief(q),
    "",
    `If you can't make it, or anything about the schedule changes, call us right away at ${CALL_NUMBER}.`,
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

// ── 12. Stale lead: still nothing sent 48h after it came in ────────────────
// Never sent while a visit is still ahead (hasUpcomingVisit), so a visit date
// here has passed: somebody went out and no price came back.
export function staleLeadMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  const visited = dayOrNull(visitDateOf(q));
  return text([
    "LEAD NEEDS ATTENTION",
    "",
    greeting,
    visited
      ? `you visited this job on ${visited} and no quote has gone out yet:`
      : `this lead came in over ${STALE_LEAD_HOURS} hours ago and no quote has gone out yet:`,
    "",
    customerBrief(q),
    "",
    visited
      ? "Send them their price, or call them if something has changed."
      : "Send them a quote, or book a visit if you need to see it first.",
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

// Leads a digest lists before pointing at the CRM.
const DIGEST_MAX_ITEMS = 6;

// One lead as a few lines in a digest. `who` only on the owner's copy.
function staleLeadItem(q: QuoteInfo, n: number, who?: string | null): string {
  const visited = dayOrNull(visitDateOf(q));
  return text([
    `${n}. ${q.name}${q.service?.trim() ? ` - ${q.service.trim()}` : ""}`,
    q.phone,
    q.address?.trim() || null,
    visited ? `Visited ${visited}, no price sent` : null,
    who ? `Assigned: ${who}` : null,
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

/**
 * Every stale lead in one text: less noise than one per lead, and it shows how
 * far behind the pipeline is. `who` labels entries for the owner's copy.
 */
export function staleLeadDigest(
  leads: { quote: QuoteInfo; who?: string | null }[],
  contractorName?: string | null,
): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  const shown = leads.slice(0, DIGEST_MAX_ITEMS);
  const rest = leads.length - shown.length;

  return text([
    `${leads.length} LEADS NEED ATTENTION`,
    "",
    greeting,
    `these came in over ${STALE_LEAD_HOURS} hours ago and no quote has gone out yet:`,
    "",
    ...shown.flatMap((l, i) => [staleLeadItem(l.quote, i + 1, l.who), ""]),
    rest > 0 ? `...and ${rest} more. Open the CRM to see all ${leads.length}.` : null,
    rest > 0 ? "" : null,
    "Send each a quote, or book a visit if you need to see it first.",
  ]);
}

// A contractor's quiet leads. `phone` is null for no number on file and for the
// unassigned pile; both still go in the owner's copy.
export type StaleLeadGroup = {
  phone?: string | null;
  name?: string | null;
  leads: QuoteInfo[];
  // From the caller's spacer, so this queues behind the run's job reminders.
  delayMinutes?: number;
};

// Everything the contractor needs to call the customer without opening anything.
// The job link needs a CRM login, so the text says so up front.
export function assignmentMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return text([
    greeting,
    `you've been assigned a new job with ${BUSINESS}.`,
    "",
    customerBrief(q),
    // No token, no link: a bare ".../job/" looks tappable and goes nowhere.
    ...(q.job_token
      ? ["", "Full details and photos:", jobLink(q.job_token), "", "Sign in with your CRM login to open it."]
      : []),
    "",
    `Please give ${firstName(q.name)} a call to introduce yourself and confirm the details.`,
  ]);
}
