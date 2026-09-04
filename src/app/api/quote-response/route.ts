import { NextResponse } from "next/server";

import { notifyCustomerApproved, notifyDeclined, notifyNeedsScheduling } from "@/lib/crm/notify";
import {
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
    options?: unknown;
  };
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
    preferredDates: Array.isArray(body.preferred_dates)
      ? body.preferred_dates.filter((d): d is string => typeof d === "string")
      : undefined,
    options: readChoices(body.options),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

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
        // No calendar event yet - there's no confirmed day until the crew picks
        // one. Thank the customer, then push the owner and crew to lock a date.
        await notifyCustomerApproved(withChoices);
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
