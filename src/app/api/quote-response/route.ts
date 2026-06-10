import { NextResponse } from "next/server";

import { alertOwner, jobLink, sendSms } from "@/lib/crm/notify";
import { getQuoteByToken, getStaffPhoneById, recordCustomerResponse } from "@/lib/crm/queries";

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

  // Best-effort texts to BOTH owner and the assigned contractor. Never let a
  // texting outage fail the customer's action.
  try {
    const q = await getQuoteByToken("public_token", token);
    if (q) {
      const price = q.quote_amount != null ? ` ($${Number(q.quote_amount).toLocaleString("en-US")})` : "";
      if (action === "accept") {
        const when = q.scheduled_date ? ` for ${q.scheduled_date}` : "";
        const disc = q.discount_accepted ? " (10% off)" : "";
        await alertOwner(`Booked: ${q.name}${when}${price}${disc}. ${q.phone}`);
        if (q.assigned_to) {
          const phone = await getStaffPhoneById(q.assigned_to);
          if (phone) {
            await sendSms(phone, `Job booked: ${q.name}${when}${price}. Details: ${jobLink(q.job_token)}`).catch(() => {});
          }
        }
      } else {
        await alertOwner(`Declined: ${q.name}. ${q.phone}`);
        if (q.assigned_to) {
          const phone = await getStaffPhoneById(q.assigned_to);
          if (phone) await sendSms(phone, `Heads up: ${q.name} declined their quote.`).catch(() => {});
        }
      }
    }
  } catch {
    // ignore — texting must never fail the customer's action
  }

  return NextResponse.json({ ok: true });
}
