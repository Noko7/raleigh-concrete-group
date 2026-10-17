import { NextResponse } from "next/server";

import { cronAuthorized } from "@/lib/crm/cron-auth";
import { REMINDER_SPACING_MINUTES, flushHeldMessages } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

// The queue's own timer: sends whatever is due. Other drains happen on the way past (the two daily crons,
// outbound texts), which covers quiet hours but not spaced reminders: a 10:15 crew text would otherwise
// wait for the evening cron.
// NOT WIRED UP: the Hobby plan's two daily crons are taken. On a plan with a third, add to vercel.json:
//   { "path": "/api/cron/drain", "schedule": "*/15 * * * *" }
// Safe to hit by hand with CRON_SECRET. Cheap when idle (one indexed SELECT); claimMessage makes racing
// drains safe.

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const flushed = await flushHeldMessages();
  return NextResponse.json({ ok: true, flushed, spacingMinutes: REMINDER_SPACING_MINUTES });
}
