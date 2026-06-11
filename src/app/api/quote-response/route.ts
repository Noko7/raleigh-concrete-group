import { NextResponse } from "next/server";

import { syncQuoteToCalendar } from "@/lib/crm/gcal";
import { notifyBooked, notifyCustomerScheduled, notifyDeclined } from "@/lib/crm/notify";
import { getQuoteByToken, getStaffPhoneById, recordCustomerResponse } from "@/lib/crm/queries";

// Customer-facing endpoint behind the unguessable public_token. Records accept
// (with a scheduled date, optionally the $150 save offer) or decline, then texts
// the owner.
export async function POST(request: Request) {
  let body: { token?: unknown; action?: unknown; discount?: unknown; scheduled_date?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const result = await recordCustomerResponse(token, {
    action,
    discount: body.discount === true,
    scheduledDate: typeof body.scheduled_date === "string" ? body.scheduled_date : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  // Best-effort texts to BOTH owner and the assigned contractor. Never let a
  // texting outage fail the customer's action.
  try {
    const q = await getQuoteByToken("public_token", token);
    if (q) {
      const contractorPhone = q.assigned_to ? await getStaffPhoneById(q.assigned_to) : null;
      if (action === "accept") {
        // Put the booked job on Google Calendar (invites the crew if assigned).
        await syncQuoteToCalendar(q.id);
        // Thank the customer for scheduling, then text the crew the JOB BOOKED details.
        await notifyCustomerScheduled(q);
        await notifyBooked(q, contractorPhone);
      } else {
        await notifyDeclined(q, contractorPhone);
      }
    }
  } catch {
    // ignore — texting must never fail the customer's action
  }

  return NextResponse.json({ ok: true });
}
