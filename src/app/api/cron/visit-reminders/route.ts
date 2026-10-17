import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/crm/cron-auth";
import { ymdInDays } from "@/lib/crm/clock";
import { flushHeldMessages, notifyVisitReminder, notifyVisitReminderCrew, spacer } from "@/lib/crm/notify";
import {
  addAdminEvent,
  getStaffContactById,
  listVisitsOn,
  markVisitCrewReminded,
  markVisitReminderSent,
} from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

// Second daily Vercel Cron, separate from /api/cron/reminders because it needs an evening run ("the night
// before"); Hobby allows two once-a-day crons. Texts customer and contractor (with address) once about
// tomorrow's in-person quote visits (not work days). Protected by CRON_SECRET.

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 6pm ET is inside business hours, so this also clears anything still queued from the morning.
  const flushed = await flushHeldMessages();

  const tomorrow = ymdInDays(1);
  let customerSent = 0;
  let crewSent = 0;
  // Several visits tomorrow: first text now, the rest 15 minutes apart.
  const nextSlot = spacer();

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
        const res = await notifyVisitReminderCrew(crew.phone, q, crew.full_name, nextSlot(crew.phone));
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
