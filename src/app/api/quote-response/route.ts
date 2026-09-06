import { NextResponse } from "next/server";

import { depositCents, toCents } from "@/lib/crm/fees";
import { notifyCustomerApproved, notifyDeclined, notifyNeedsScheduling } from "@/lib/crm/notify";
import { payeeState } from "@/lib/crm/payments";
import {
  addAdminEvent,
  getQuoteByToken,
  getStaffPhoneById,
  recordCustomerResponse,
  type OptionChoice,
} from "@/lib/crm/queries";

// One answer per optional line item, keyed by option id. Anything that isn't a
// uuid mapped to accepted/declined is dropped here rather than trusted through
// to the database, and a quote whose options go missing on the way is caught by
// recordCustomerResponse refusing an unanswered option.
function readChoices(raw: unknown): Record<string, OptionChoice> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, OptionChoice> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    if (value === "accepted" || value === "declined") out[id] = value;
  }
  return out;
}

// Customer-facing endpoint behind the unguessable public_token. Records accept
// (with a scheduled date, optionally the $150 save offer) or decline, then texts
// the owner.
export async function POST(request: Request) {
  let body: {
    token?: unknown;
    action?: unknown;
    discount?: unknown;
    preferred_dates?: unknown;
    preferred_times?: unknown;
    options?: unknown;
    pay?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  // How they said they'd like to pay, taken at the moment they approved. It is
  // recorded, not enforced: what a job is owed comes from the ledger, and a
  // customer who said "card" and then hands the crew cash has changed nothing
  // except what the crew was expecting.
  const payChoice = body.pay === "card" || body.pay === "direct" ? body.pay : null;

  const result = await recordCustomerResponse(token, {
    action,
    discount: body.discount === true,
    preferredDates: Array.isArray(body.preferred_dates)
      ? body.preferred_dates.filter((d): d is string => typeof d === "string")
      : undefined,
    // Mapped rather than filtered, so a missing time in the middle doesn't
    // shift every later one onto the wrong day. recordCustomerResponse
    // shape-checks each entry and nulls anything it doesn't recognise.
    preferredTimes: Array.isArray(body.preferred_times)
      ? body.preferred_times.map((t) => (typeof t === "string" ? t : null))
      : undefined,
    options: readChoices(body.options),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // Their answer was already on file and nothing changed, so nobody is told
  // again. The customer still gets their confirmation screen - from their side
  // the button worked, which is the truth.
  if (result.duplicate) return NextResponse.json({ ok: true });

  // Best-effort texts to BOTH owner and the assigned contractor. Never let a
  // texting outage fail the customer's action.
  try {
    const q = await getQuoteByToken("public_token", token);
    if (q) {
      const contractorPhone = q.assigned_to ? await getStaffPhoneById(q.assigned_to) : null;
      // What they actually bought. The crew and the office need this before
      // anything else: "approved" on a quote with options doesn't say whether
      // there's a sidewalk to pour.
      const chosen = {
        accepted: (result.accepted ?? []).map((o) => ({ title: o.title, amount: Number(o.amount) })),
        declined: (result.declined ?? []).map((o) => ({ title: o.title, amount: Number(o.amount) })),
      };
      const withChoices = { ...q, chosen };
      if (action === "accept") {
        if (payChoice) await addAdminEvent(q.id, "payment_choice", { choice: payChoice });
        // The deposit ask only goes out if the crew on this job can actually
        // take a card. On a cash-only job the customer is told nothing about
        // paying online, because there is nothing there for them.
        const payee = await payeeState(q);
        const deposit = payee.ok ? depositCents(toCents(q.quote_amount)) : null;
        // No calendar event yet - there's no confirmed day until the crew picks
        // one. Thank the customer, then push the owner and crew to lock a date.
        await notifyCustomerApproved(withChoices, deposit);
        await notifyNeedsScheduling(withChoices, contractorPhone);
      } else {
        await notifyDeclined(q, contractorPhone);
      }
    }
  } catch {
    // ignore - texting must never fail the customer's action
  }

  return NextResponse.json({ ok: true });
}
