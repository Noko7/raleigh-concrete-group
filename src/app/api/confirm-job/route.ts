import { NextResponse } from "next/server";

import { notifyUnconfirmed } from "@/lib/crm/notify";
import { getStaffPhoneById, recordJobConfirmation } from "@/lib/crm/queries";

// Customer taps the link in their 2-day reminder. Confirm locks the job in;
// reschedule pings the owner + contractor to follow up.
export async function POST(request: Request) {
  let body: { token?: unknown; action?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "confirm" || body.action === "reschedule" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const result = await recordJobConfirmation(token, action);
  if (!result.ok) return NextResponse.json(result, { status: 400 });

  if (action === "reschedule" && result.quote) {
    try {
      const phone = result.quote.assigned_to ? await getStaffPhoneById(result.quote.assigned_to) : null;
      await notifyUnconfirmed(result.quote, phone);
    } catch {
      // texting must never fail the customer's action
    }
  }

  return NextResponse.json({ ok: true });
}
