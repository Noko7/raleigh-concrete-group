import { NextResponse } from "next/server";

import { REMINDER_SPACING_MINUTES, flushHeldMessages } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

// The queue's own timer. Sends whatever is due and nothing else.
//
// Everything else in this app that drains the held-message queue does it on the
// way past - the two daily crons on their way in, and every outbound text
// during business hours. That is enough for quiet hours, where the queue fills
// overnight and one morning run empties it.
//
// It is not enough for spaced reminders. A crew reminder queued for 10:15am
// only leaves when something drains the queue, and if the morning is quiet the
// next drain is the 6pm cron - which turns "spread these out over an hour" into
// "send them this evening". This route is what makes the spacing mean what it
// says, by running often enough to be the thing that catches them.
//
// NOT WIRED UP BY DEFAULT. Vercel's Hobby plan allows two cron jobs, each once
// a day, and both slots are taken (/api/cron/reminders, /api/cron/visit-reminders).
// On a plan that allows a third, add this to vercel.json:
//
//   { "path": "/api/cron/drain", "schedule": "*/15 * * * *" }
//
// Until then the endpoint is inert - nothing calls it, and the spacing still
// works, just against the coarser drain the two daily crons provide. It is also
// safe to hit by hand (with the same CRON_SECRET) if you want the queue emptied
// right now.
//
// Cheap when there is nothing to do: one indexed SELECT that returns no rows.
// Racing another drain is safe - claimMessage means each text is sent once.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const flushed = await flushHeldMessages();
  return NextResponse.json({ ok: true, flushed, spacingMinutes: REMINDER_SPACING_MINUTES });
}
