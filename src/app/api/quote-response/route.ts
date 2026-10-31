import { NextResponse } from "next/server";

import { ECONSENT_TEXT, ECONSENT_VERSION } from "@/lib/crm/constants";
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
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ONLINE_CARD_PAYMENTS } from "@/lib/crm/stripe";

// Keyed by option id. Anything not a uuid mapped to accepted/declined is dropped; recordCustomerResponse
// refuses a quote with an unanswered option.
function readChoices(raw: unknown): Record<string, OptionChoice> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, OptionChoice> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    if (value === "accepted" || value === "declined") out[id] = value;
  }
  return out;
}

// Behind the unguessable public_token. Records accept (with a date, optionally the $150 save offer) or
// decline, then texts the owner.
export async function POST(request: Request) {
  let body: {
    token?: unknown;
    action?: unknown;
    discount?: unknown;
    preferred_dates?: unknown;
    preferred_times?: unknown;
    options?: unknown;
    package?: unknown;
    pay?: unknown;
    pay_methods?: unknown;
    econsent?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  // Duplicates are already handled downstream; this only stops a script on the endpoint.
  if (await rateLimit(`qresp:${clientIp(request)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please give us a call." },
      { status: 429 },
    );
  }

  // An approval needs the consent box ticked, on the current wording: agreements and invoices for the job are
  // sent electronically. A page opened before the box existed (or before the wording changed) is asked to
  // refresh rather than approving under words the customer never saw.
  let consent: { version: string } | null = null;
  if (action === "accept") {
    const c = body.econsent as { agreed?: unknown; version?: unknown } | undefined;
    if (!c || typeof c !== "object" || c.version !== ECONSENT_VERSION) {
      return NextResponse.json(
        { ok: false, error: "This page was updated. Please refresh it and approve again." },
        { status: 400 },
      );
    }
    if (c.agreed !== true) {
      return NextResponse.json(
        { ok: false, error: "Please tick the box agreeing to receive documents electronically." },
        { status: 400 },
      );
    }
    consent = { version: ECONSENT_VERSION };
  }

  // Recorded, not enforced: what a job is owed comes from the ledger.
  const payChoice = body.pay === "card" || body.pay === "direct" ? body.pay : null;

  const result = await recordCustomerResponse(token, {
    action,
    discount: body.discount === true,
    preferredDates: Array.isArray(body.preferred_dates)
      ? body.preferred_dates.filter((d): d is string => typeof d === "string")
      : undefined,
    // Mapped, not filtered, so a missing time doesn't shift later ones onto the wrong day.
    preferredTimes: Array.isArray(body.preferred_times)
      ? body.preferred_times.map((t) => (typeof t === "string" ? t : null))
      : undefined,
    options: readChoices(body.options),
    // Matched against this quote's own packages downstream, so another quote's id can't set this price.
    packageId:
      typeof body.package === "string" && /^[0-9a-f-]{36}$/i.test(body.package) ? body.package : undefined,
    // While online card payments are off, the customer picks how they'll pay the contractor (checked against
    // the methods that contractor takes).
    payMethods: action === "accept" ? body.pay_methods : undefined,
    requirePayMethods: action === "accept" && !ONLINE_CARD_PAYMENTS,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // The consent itself, kept as evidence: the exact words, their version, when, and from where. Logged on every
  // accepted approval, a repeat included (it is still a fresh tick of the box).
  // A failure doesn't undo the approval, but it is logged loudly so the missing record can be followed up.
  if (consent) {
    const q = await getQuoteByToken("public_token", token).catch(() => null);
    const stored = q
      ? await addAdminEvent(q.id, "customer_econsent", {
          version: consent.version,
          text: ECONSENT_TEXT,
          ip: clientIp(request),
          user_agent: (request.headers.get("user-agent") ?? "").slice(0, 300),
        }).catch(() => false)
      : false;
    if (!stored) console.error("[econsent] consent NOT recorded for an approved quote", q?.id ?? `token ${token.slice(0, 6)}…`);
  }

  // Already on file and unchanged: nobody is told again, but the customer still sees success.
  if (result.duplicate) return NextResponse.json({ ok: true });

  // Best-effort texts to owner and contractor: a texting outage must never fail the customer's action.
  try {
    const q = await getQuoteByToken("public_token", token);
    if (q) {
      const contractorPhone = q.assigned_to ? await getStaffPhoneById(q.assigned_to) : null;
      // What they bought, the chosen package first (concrete or asphalt?).
      const pick = result.package;
      const chosen = {
        accepted: [
          ...(pick ? [{ title: pick.title, amount: Number(pick.amount) }] : []),
          ...(result.accepted ?? []).map((o) => ({ title: o.title, amount: Number(o.amount) })),
        ],
        declined: (result.declined ?? []).map((o) => ({ title: o.title, amount: Number(o.amount) })),
      };
      const withChoices = { ...q, chosen };
      if (action === "accept") {
        if (result.payMethods?.length) {
          await addAdminEvent(q.id, "payment_choice", { choice: "direct", methods: result.payMethods });
        } else if (payChoice) {
          await addAdminEvent(q.id, "payment_choice", { choice: payChoice });
        }
        // The deposit ask only goes out if the crew can take a card.
        const payee = await payeeState(q);
        const deposit = payee.ok ? depositCents(toCents(q.quote_amount)) : null;
        // No calendar event until the crew picks a day.
        await notifyCustomerApproved(withChoices, deposit);
        await notifyNeedsScheduling(withChoices, contractorPhone);
      } else {
        await notifyDeclined(q, contractorPhone);
      }
    }
  } catch {
    // texting must never fail the customer's action
  }

  return NextResponse.json({ ok: true });
}
