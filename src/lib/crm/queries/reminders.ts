// Server-only CRM data access: cron reminders and the reminder-link confirmation. Re-exported from ../queries.ts.
import { ymdInDays } from "../clock";
import { visitDateOf, VISIT_GRACE_DAYS } from "../constants";
import { pgAdmin } from "../rest";
import type { Quote } from "../types";
import { ISO_DATE } from "./shared";

// ── 2-day reminder (cron) ───────────────────────────────────────────────────
// Booked jobs landing on `date` that haven't had a reminder sent yet.
export async function listBookedForReminder(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(
    `quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&reminder_sent_at=is.null&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markReminderSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
  });
}

// ── Crew reminders (cron) ───────────────────────────────────────────────────
// Booked jobs on `date`. Which stages went out is in crew_reminders, checked by
// the caller.
export async function listJobsOn(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(`quote_requests?status=eq.scheduled&scheduled_date=eq.${date}&archived_at=is.null&select=*`);
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

// Reset so a new or moved date gets its own full run of crew reminders. Best-effort.
export async function clearCrewReminders(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: null }),
  }).catch(() => {});
}

// Record a reminder stage ("3", "1", "0"). An array, so adding a stage needs no
// migration. Re-confirming a date clears it.
export async function markCrewReminded(quote: Quote, stage: string): Promise<void> {
  const already = quote.crew_reminders ?? [];
  if (already.includes(stage)) return;
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quote.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ crew_reminders: [...already, stage] }),
  }).catch(() => {});
}

// Reminders never chase anything older than this: stale leads are a pipeline
// cleanup, not a crew text, and old quotes shouldn't suddenly be "waiting". It
// also stops the first run after deploy texting every historical row.
export const REMINDER_MAX_AGE_DAYS = 14;

function ageWindow(column: string, hours: number): string {
  const newest = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const oldest = new Date(Date.now() - REMINDER_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return `&${column}=lt.${encodeURIComponent(newest)}&${column}=gt.${encodeURIComponent(oldest)}`;
}

// A lead with a confirmed visit ahead isn't being ignored: the price waits for
// the visit. After it, they get VISIT_GRACE_DAYS (a visit on the 10th holds the
// lead through the 12th).
export function hasUpcomingVisit(q: Quote, graceFrom = ymdInDays(-VISIT_GRACE_DAYS)): boolean {
  const booked = visitDateOf(q);
  return Boolean(booked && booked >= graceFrom);
}

// ── Stale-lead nudge (cron) ──────────────────────────────────────────────────
// "new" leads older than `hours` (within the window above) with no upcoming
// visit. Status stays "new" until a price is sent.
export async function listStaleLeads(hours: number): Promise<Quote[]> {
  const res = await pgAdmin(
    `quote_requests?status=eq.new${ageWindow("created_at", hours)}` +
      `&stale_lead_reminded_at=is.null&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  // Filtered in JS so visitDateOf stays the single definition of a booked visit.
  return ((await res.json()) as Quote[]).filter((q) => !hasUpcomingVisit(q));
}

export async function markStaleLeadReminded(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ stale_lead_reminded_at: new Date().toISOString() }),
  });
}

// ── Quote-visit night-before reminders (cron) ───────────────────────────────
// Confirmed in-person visits on `date` (an online row's fallback slot never
// counts). Lost leads excluded: the visit isn't happening.
export async function listVisitsOn(date: string): Promise<Quote[]> {
  if (!ISO_DATE.test(date)) return [];
  const res = await pgAdmin(
    `quote_requests?quote_type=eq.inperson&visit_date=eq.${date}` +
      `&status=neq.lost&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markVisitReminderSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ visit_reminder_sent_at: new Date().toISOString() }),
  });
}

export async function markVisitCrewReminded(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ visit_crew_reminded_at: new Date().toISOString() }),
  });
}

// ── 48h no-response follow-up (cron) ────────────────────────────────────────
// Sent quotes unanswered for `hours` (within the window above), not yet followed up.
export async function listUnansweredQuotes(hours: number): Promise<Quote[]> {
  const res = await pgAdmin(
    `quote_requests?status=eq.quoted${ageWindow("quote_sent_at", hours)}` +
      `&customer_response=is.null&quote_followup_sent_at=is.null&archived_at=is.null&select=*`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Quote[];
}

export async function markQuoteFollowupSent(id: string): Promise<void> {
  await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_followup_sent_at: new Date().toISOString() }),
  });
}

// ── Customer confirmation from the reminder link (token-gated) ──────────────
export async function recordJobConfirmation(
  token: string,
  action: "confirm" | "reschedule",
): Promise<{ ok: boolean; error?: string; quote?: Quote }> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };
  const res = await pgAdmin(`quote_requests?public_token=eq.${token}&select=*&limit=1`);
  if (!res.ok) return { ok: false, error: "Could not load your job." };
  const q = ((await res.json()) as Quote[])[0];
  if (!q) return { ok: false, error: "Job not found." };

  // Confirmation is a flag (timestamp) on a Scheduled job, not a pipeline stage.
  const patch: Partial<Quote> =
    action === "confirm" ? { confirmed_at: new Date().toISOString() } : {};

  if (Object.keys(patch).length > 0) {
    const upd = await pgAdmin(`quote_requests?id=eq.${q.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!upd.ok) return { ok: false, error: "Could not save. Please call us." };
  }

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: q.id,
      type: action === "confirm" ? "customer_confirmed" : "customer_unconfirmed",
      meta: { scheduled_date: q.scheduled_date ?? null },
    }),
  });
  return { ok: true, quote: q };
}
