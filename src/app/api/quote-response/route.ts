import { NextResponse } from "next/server";

import { alertOwner } from "@/lib/crm/notify";
import { getQuoteByToken, recordCustomerResponse } from "@/lib/crm/queries";

// Customer-facing endpoint behind the unguessable public_token. Records accept
// (with a scheduled date, optionally the 10% save offer) or decline, then texts
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

  // Best-effort owner text.
  try {
    const q = await getQuoteByToken("public_token", token);
    if (q) {
      const msg =
        action === "accept"
          ? `${q.name} ACCEPTED their quote${q.scheduled_date ? `, booked ${q.scheduled_date}` : ""}${
              q.discount_accepted ? " (10% off)" : ""
            }. ${q.phone}`
          : `${q.name} declined their quote. ${q.phone}`;
      await alertOwner(msg);
    }
  } catch {
    // ignore — texting must never fail the customer's action
  }

  return NextResponse.json({ ok: true });
}
