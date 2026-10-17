// Server-only SMS notifications: cron reminders and follow-ups. Never import from a client component.
// Re-exported from ../notify.ts, whose header documents the provider settings.
import { phoneDisplay } from "@/lib/site-data";
import { type SendResult, toE164, sendSmsResult, sendSms, ownerRecipients, alertOwner } from "./send";
import {
  BUSINESS,
  CALL_NUMBER,
  block,
  text,
  type QuoteInfo,
  firstName,
  prettyDay,
  customerBrief,
  dayAndTime,
} from "./format";
import {
  jobLink,
  quoteLink,
  confirmLink,
  crewReminderMessage,
  staleLeadMessage,
  staleLeadDigest,
  type StaleLeadGroup,
} from "./templates";

// ── 9. Two days out: ask the customer to confirm ────────────────────────────
export async function notifyReminder(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}. Your project is coming up:`,
      "",
      dayAndTime(q),
      "",
      "Please confirm it here:",
      confirmLink(q.public_token ?? ""),
    ]),
    { quoteId: q.id, kind: "reminder", role: "customer" },
  );
}
export async function notifyUnconfirmed(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = text([
    "CUSTOMER COULD NOT CONFIRM",
    "",
    ...block("Customer:", q.name),
    ...block("Phone:", q.phone),
    ...block("Was booked for:", dayAndTime(q)),
    "Please reach out to reschedule.",
  ]);
  await alertOwner(msg, null, { quoteId: q.id, kind: "unconfirmed" });
  if (contractorPhone) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "unconfirmed", role: "crew" }).catch(() => {});
  }
}

export async function notifyCrewReminder(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  daysOut: number,
  contractorName?: string | null,
  // Minutes to hold this back so several jobs don't arrive at once. 0 sends now.
  delayMinutes = 0,
): Promise<SendResult | null> {
  if (!contractorPhone) return null;
  return sendSmsResult(
    contractorPhone,
    crewReminderMessage(q, daysOut, contractorName),
    {
      quoteId: q.id,
      kind: `crew_reminder_${daysOut}`,
      role: "crew",
    },
    { delayMinutes },
  ).catch(() => null);
}

/**
 * Each contractor gets their own stale leads, the owner everybody's (including
 * unassigned), one text per person per run. A contractor who is also an owner
 * is skipped: the owner digest already lists their jobs.
 */
export async function notifyStaleLeads(
  groups: StaleLeadGroup[],
): Promise<{ owner: boolean; contractors: number; leads: number }> {
  const withLeads = groups.filter((g) => g.leads.length > 0);
  const leadCount = withLeads.reduce((n, g) => n + g.leads.length, 0);
  if (leadCount === 0) return { owner: false, contractors: 0, leads: 0 };

  // A single lead gets the fuller single-lead message; the digest is for pile-ups.
  const only = leadCount === 1 ? withLeads[0] : null;

  await alertOwner(
    only
      ? staleLeadMessage(only.leads[0], only.name)
      : staleLeadDigest(withLeads.flatMap((g) => g.leads.map((quote) => ({ quote, who: g.name || "Unassigned" })))),
    null,
    // A digest has no single job; each lead's trace is its stale_lead_reminded event.
    only ? { quoteId: only.leads[0].id, kind: "stale_lead" } : { kind: "stale_lead_digest" },
  );

  const owners = new Set(await ownerRecipients());
  let contractors = 0;
  for (const g of withLeads) {
    const phone = g.phone ? toE164(g.phone) : null;
    if (!phone || owners.has(phone)) continue;
    const msg =
      g.leads.length === 1
        ? staleLeadMessage(g.leads[0], g.name)
        : staleLeadDigest(
            g.leads.map((quote) => ({ quote })),
            g.name,
          );
    const log =
      g.leads.length === 1
        ? { quoteId: g.leads[0].id, kind: "stale_lead", role: "crew" as const }
        : { kind: "stale_lead_digest", role: "crew" as const };
    // A queued text counts as handled; the queue row records what happens next.
    if (await sendSms(phone, msg, log, { delayMinutes: g.delayMinutes ?? 0 }).catch(() => false)) contractors += 1;
  }

  return { owner: true, contractors, leads: leadCount };
}

// ── 13. Quote visit, night before: customer + contractor ───────────────────
// notifyReminder covers booked work days; visits get one reminder, the night
// before, since a visit is an hour, not a crew and a truck.
export async function notifyVisitReminder(q: QuoteInfo): Promise<SendResult> {
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}. Just a reminder - we'll be out tomorrow for your free quote visit:`,
      "",
      when,
      "",
      q.address?.trim() || null,
      "",
      `See you then! Call or text ${phoneDisplay} if anything changes.`,
    ]),
    { quoteId: q.id, kind: "visit_reminder", role: "customer" },
  );
}

export async function notifyVisitReminderCrew(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  contractorName?: string | null,
  delayMinutes = 0,
): Promise<SendResult | null> {
  if (!contractorPhone) return null;
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return sendSmsResult(
    contractorPhone,
    text([
      "QUOTE VISIT TOMORROW",
      "",
      greeting,
      "you have a quote visit tomorrow:",
      "",
      ...block("When:", when),
      customerBrief(q),
      "",
      `Can't make it? Call ${CALL_NUMBER} as soon as you know.`,
      "",
      q.job_token ? jobLink(q.job_token) : null,
    ]),
    { quoteId: q.id, kind: "visit_reminder", role: "crew" },
    { delayMinutes },
  ).catch(() => null);
}

// ── 14. 48h follow-up: a sent quote nobody has accepted or declined ────────
// Says the quote is waiting, never the price (see `usd`). The days-left line is
// what moves people; a decision with no deadline gets postponed.
export async function notifyQuoteFollowup(q: QuoteInfo, daysLeft?: number | null): Promise<SendResult> {
  const deadline =
    daysLeft != null && daysLeft > 0
      ? daysLeft === 1
        ? "It expires tomorrow."
        : `It expires in ${daysLeft} days.`
      : null;

  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "your concrete project is waiting! Accept or decline your quote now:",
      "",
      quoteLink(q.public_token ?? ""),
      "",
      deadline,
      "",
      `Questions? Call or text ${phoneDisplay} any time.`,
    ]),
    { quoteId: q.id, kind: "quote_followup", role: "customer" },
  );
}
