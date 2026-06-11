import { NextResponse } from "next/server";

import { notifyReminder } from "@/lib/crm/notify";
import { addAdminEvent, listBookedForReminder, markReminderSent } from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

// Daily Vercel Cron. Texts a confirmation link to customers whose booked job is
// ~2 days out. Protected by CRON_SECRET (Vercel sends it as a Bearer token).
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function dateInDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const target = dateInDays(2);
  const jobs = await listBookedForReminder(target);

  let sent = 0;
  for (const q of jobs) {
    const res = await notifyReminder(q).catch(() => null);
    await markReminderSent(q.id);
    await addAdminEvent(q.id, "reminder_sent", { scheduled_date: q.scheduled_date });
    if (res?.ok) sent += 1;
  }

  return NextResponse.json({ ok: true, date: target, found: jobs.length, sent });
}
