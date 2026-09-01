import { NextResponse } from "next/server";

import { ymdInDays } from "@/lib/crm/clock";
import { flushHeldMessages, notifyVisitReminder, notifyVisitReminderCrew } from "@/lib/crm/notify";
import {
  addAdminEvent,
  getStaffContactById,
  listVisitsOn,
  markVisitCrewReminded,
  markVisitReminderSent,
} from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

// Second daily Vercel Cron, kept separate from /api/cron/reminders because
// this one needs an evening run time - "the night before" - while the other
// runs in the morning. Vercel's Hobby plan allows up to two cron jobs, each
// once a day, so this fits without needing a paid plan.
//
// Job: tomorrow's in-person quote visits (the free estimate appointment, not
// a booked work day) - texts both the customer and the assigned contractor
// (with the address) once.
// Protected by CRON_SECRET (Vercel sends it as a Bearer token) - same env var
// as /api/cron/reminders.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 6pm ET is inside business hours, so this run can also clear anything still
  // queued from the morning - a held text shouldn't sit all day because nobody
  // happened to use the app.
  const flushed = await flushHeldMessages();

  const tomorrow = ymdInDays(1);
  let customerSent = 0;
  let crewSent = 0;

  for (const q of await listVisitsOn(tomorrow)) {
    let touched = false;

    if (!q.visit_reminder_sent_at) {
      const res = await notifyVisitReminder(q).catch(() => null);
      await markVisitReminderSent(q.id);
      touched = true;
      if (res?.ok) customerSent += 1;
    }

    if (!q.visit_crew_reminded_at && q.assigned_to) {
      const crew = await getStaffContactById(q.assigned_to);
      if (crew?.phone) {
        const res = await notifyVisitReminderCrew(crew.phone, q, crew.full_name);
        await markVisitCrewReminded(q.id);
        touched = true;
        if (res?.ok) crewSent += 1;
      }
    }

    if (touched) {
      await addAdminEvent(q.id, "visit_reminder_sent", { visit_date: q.visit_date, assigned_to: q.assigned_to });
    }
  }

  return NextResponse.json({ ok: true, date: tomorrow, flushed, customerSent, crewSent });
}
