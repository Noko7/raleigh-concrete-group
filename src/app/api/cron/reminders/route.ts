import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/crm/cron-auth";
import { ymdInDays } from "@/lib/crm/clock";
import { CREW_REMINDER_DAYS, STALE_LEAD_HOURS } from "@/lib/crm/constants";
import {
  REMINDER_SPACING_MINUTES,
  flushHeldMessages,
  notifyCrewReminder,
  notifyQuoteFollowup,
  notifyReminder,
  notifyStaleLeads,
  spacer,
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

// Daily Vercel Cron, 13:00 UTC (9am EDT / 8am EST). Protected by CRON_SECRET (Bearer token).
//   0. Flush texts quiet hours held overnight.
//   1. Ask the customer to confirm a job ~2 days out.
//   2. Remind the crew 3 days out, the day before and the morning of; soonest first, 15 min apart per person.
//   3. Nudge contractor (+owner) about leads unquoted/unvisited for STALE_LEAD_HOURS, one digest each.
//   4. Follow up a sent quote unanswered after 48h.
// Hobby plan allows one run a day, so thresholds can be overshot by ~24h. Night-before visit reminders are
// /api/cron/visit-reminders.
// Why 13:00: this run is the floor under the quiet-hours queue, so earlier is better, but 12:00 UTC is
// 7am EST (inside quiet hours). Exactly 8am all year needs /api/cron/drain (see that file).

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // First: last night's held texts have waited longest.
  const flushed = await flushHeldMessages();

  // One spacer for the crew countdown and stale nudge: a contractor's several texts go 15 minutes apart
  // instead of as one buzz. Customers get at most one text per run, so they aren't spaced.
  const nextSlot = spacer();

  // 1. Customer confirmation, two days out.
  const target = ymdInDays(2);
  const jobs = await listBookedForReminder(target);

  let sent = 0;
  for (const q of jobs) {
    const res = await notifyReminder(q).catch(() => null);
    await markReminderSent(q.id);
    await addAdminEvent(q.id, "reminder_sent", { scheduled_date: q.scheduled_date });
    if (res?.ok) sent += 1;
  }

  // 2. Crew countdown. Each stage is recorded on the job so a retried run can't repeat a reminder.
  let crewSent = 0;
  let crewQueued = 0;
  // Soonest first gets the un-delayed slot: "on site this morning" must not wait behind a job three days out.
  for (const daysOut of [...CREW_REMINDER_DAYS].sort((a, b) => a - b)) {
    const stage = String(daysOut);
    const day = ymdInDays(daysOut);
    for (const q of await listJobsOn(day)) {
      if (!q.assigned_to) continue;
      if ((q.crew_reminders ?? []).includes(stage)) continue;

      const crew = await getStaffContactById(q.assigned_to);
      if (!crew?.phone) continue;

      const res = await notifyCrewReminder(crew.phone, q, daysOut, crew.full_name, nextSlot(crew.phone));
      // Marked either way (failures are logged by sendSmsResult); retrying tomorrow would be for the wrong day.
      await markCrewReminded(q, stage);
      await addAdminEvent(q.id, "crew_reminded", {
        days_out: daysOut,
        to: crew.phone,
        delivered: Boolean(res?.ok),
        // So a spaced reminder doesn't read as failed in the log.
        queued_for: res?.spaced ? (res.sendAfterLabel ?? null) : null,
      });
      if (res?.ok) crewSent += 1;
      else if (res?.spaced) crewQueued += 1;
    }
  }

  // 3. Stale leads: one text per person listing all of theirs ("you are six behind"). The owner's copy spans
  // everybody, including unassigned.
  const stale = await listStaleLeads(STALE_LEAD_HOURS);
  const byContractor = new Map<string, StaleLeadGroup>();
  for (const q of stale) {
    const key = q.assigned_to ?? "";
    let group = byContractor.get(key);
    if (!group) {
      // One lookup per contractor, not per lead.
      const contractor = q.assigned_to ? await getStaffContactById(q.assigned_to) : null;
      group = { phone: contractor?.phone, name: contractor?.full_name, leads: [] };
      byContractor.set(key, group);
    }
    group.leads.push(q);
  }
  // After booked-work reminders: the least time-critical text.
  const staleSent = await notifyStaleLeads(
    [...byContractor.values()].map((g) => ({ ...g, delayMinutes: nextSlot(g.phone) })),
  ).catch(() => null);
  // Logged per lead even though the digest is one text.
  for (const q of stale) {
    await markStaleLeadReminded(q.id);
    await addAdminEvent(q.id, "stale_lead_reminded", { assigned_to: q.assigned_to, of: stale.length });
  }

  // 4. 48h no-response quote follow-up.
  let followupSent = 0;
  for (const q of await listUnansweredQuotes(48)) {
    // Whole days until the link expires, for the text.
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
    crewQueued,
    spacingMinutes: REMINDER_SPACING_MINUTES,
    staleSent,
    followupSent,
  });
}
