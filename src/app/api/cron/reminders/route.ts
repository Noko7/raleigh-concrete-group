import { NextResponse } from "next/server";

import { ymdInDays } from "@/lib/crm/clock";
import { CREW_REMINDER_DAYS } from "@/lib/crm/constants";
import {
  flushHeldMessages,
  notifyCrewReminder,
  notifyQuoteFollowup,
  notifyReminder,
  notifyStaleLeads,
  type StaleLeadGroup,
} from "@/lib/crm/notify";
import {
  addAdminEvent,
  getStaffContactById,
  listBookedForReminder,
  listJobsOn,
  listStaleLeads,
  listUnansweredQuotes,
  markCrewReminded,
  markQuoteFollowupSent,
  markReminderSent,
  markStaleLeadReminded,
} from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

// Daily Vercel Cron (14:00 UTC, so 10am ET / 9am EST). Five jobs:
//   0. Send anything quiet hours held overnight (see flushHeldMessages).
//   1. Ask the customer to confirm a job that's ~2 days out.
//   2. Remind the assigned crew 3 days out, the day before, and the morning of.
//   3. Nudge the assigned contractor (+owner) about leads nobody has quoted
//      or scheduled a visit for, 12+ hours old - one text listing all of
//      theirs, not one per lead.
//   4. Follow up with a customer who hasn't accepted or declined a sent
//      quote within 48 hours.
// Jobs 1-4 only get checked once a day here rather than more often, since
// Vercel's Hobby plan caps cron at once-a-day - a lead can go up to ~24h past
// its threshold before this notices, which is an acceptable tradeoff for
// staying on the free plan. See /api/cron/visit-reminders for the other daily
// cron (night-before quote-visit reminders, which need an evening run time).
// Protected by CRON_SECRET (Vercel sends it as a Bearer token).
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── 0. Anything quiet hours held overnight ────────────────────────────────
  // This run is the floor under the queue: whatever the night collected goes
  // out here at the latest, whether or not anybody has touched the app since
  // 8am. Deliberately first - a text raised at 9pm last night is older news
  // than anything below, and it has been waiting longer.
  const flushed = await flushHeldMessages();

  // ── 1. Customer confirmation, two days out ────────────────────────────────
  const target = ymdInDays(2);
  const jobs = await listBookedForReminder(target);

  let sent = 0;
  for (const q of jobs) {
    const res = await notifyReminder(q).catch(() => null);
    await markReminderSent(q.id);
    await addAdminEvent(q.id, "reminder_sent", { scheduled_date: q.scheduled_date });
    if (res?.ok) sent += 1;
  }

  // ── 2. Crew countdown ─────────────────────────────────────────────────────
  // Each stage is recorded on the job, so a retried or manually triggered cron
  // run can't text the same crew member the same reminder twice.
  let crewSent = 0;
  for (const daysOut of CREW_REMINDER_DAYS) {
    const stage = String(daysOut);
    const day = ymdInDays(daysOut);
    for (const q of await listJobsOn(day)) {
      if (!q.assigned_to) continue;
      if ((q.crew_reminders ?? []).includes(stage)) continue;

      const crew = await getStaffContactById(q.assigned_to);
      if (!crew?.phone) continue;

      const res = await notifyCrewReminder(crew.phone, q, daysOut, crew.full_name);
      // Marked either way: a failed send is logged by sendSmsResult, and
      // retrying it tomorrow would be a reminder for the wrong day.
      await markCrewReminded(q, stage);
      await addAdminEvent(q.id, "crew_reminded", {
        days_out: daysOut,
        to: crew.phone,
        delivered: Boolean(res?.ok),
      });
      if (res?.ok) crewSent += 1;
    }
  }

  // ── 3. Stale leads: nobody has quoted or scheduled a visit in 12h ─────────
  // One text per person, listing all of their stale leads - not one text per
  // lead. A contractor who was off yesterday came back to six near-identical
  // alerts and read none of them; a list is less noise and says more, because
  // "you are six behind" is the actual news. The owner's copy spans everybody,
  // so the unassigned pile has somewhere to be reported too.
  const stale = await listStaleLeads(12);
  const byContractor = new Map<string, StaleLeadGroup>();
  for (const q of stale) {
    const key = q.assigned_to ?? "";
    let group = byContractor.get(key);
    if (!group) {
      // One lookup per contractor rather than one per lead.
      const contractor = q.assigned_to ? await getStaffContactById(q.assigned_to) : null;
      group = { phone: contractor?.phone, name: contractor?.full_name, leads: [] };
      byContractor.set(key, group);
    }
    group.leads.push(q);
  }
  const staleSent = await notifyStaleLeads([...byContractor.values()]).catch(() => null);
  // Marked and recorded per lead either way: the digest is how it was sent, but
  // "this job was chased" still belongs on this job's own activity log.
  for (const q of stale) {
    await markStaleLeadReminded(q.id);
    await addAdminEvent(q.id, "stale_lead_reminded", { assigned_to: q.assigned_to, of: stale.length });
  }

  // ── 4. 48h no-response quote follow-up ─────────────────────────────────────
  let followupSent = 0;
  for (const q of await listUnansweredQuotes(48)) {
    // Whole days left before the link stops working, so the text can say so.
    const daysLeft = q.quote_expires_at
      ? Math.ceil((new Date(q.quote_expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
    const res = await notifyQuoteFollowup(q, daysLeft).catch(() => null);
    await markQuoteFollowupSent(q.id);
    await addAdminEvent(q.id, "quote_followup_sent", { quote_amount: q.quote_amount });
    if (res?.ok) followupSent += 1;
  }

  return NextResponse.json({
    ok: true,
    date: target,
    flushed,
    found: jobs.length,
    sent,
    crewSent,
    staleSent,
    followupSent,
  });
}
