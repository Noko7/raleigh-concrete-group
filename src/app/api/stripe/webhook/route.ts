import { addAdminEvent } from "@/lib/crm/queries";
import {
  applyRefund,
  findPaymentBySession,
  markSessionPaid,
  saveStripeAccount,
  settleJobIfPaid,
  staffByStripeAccount,
} from "@/lib/crm/payments";
import { verifyWebhook, type StripeEvent } from "@/lib/crm/stripe";
import { pgAdmin } from "@/lib/crm/rest";

// Stripe's side of the conversation.
//
// Lives under /api rather than /crm/api on purpose: the CRM's middleware
// redirects any request without a session cookie to the login page, and Stripe
// sends no cookies. An endpoint under /crm would answer every delivery with a
// 307, which Stripe counts as a failure and eventually disables the endpoint
// over - while every payment silently stayed marked unpaid.
//
// The event scope matters just as much. Direct charges belong to the connected
// account, not to the platform, so this only receives checkout.session.completed
// if the endpoint is configured with "Events from: Connected accounts".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node, not Edge: signature verification needs node:crypto's HMAC, and the raw
// request body has to survive byte-for-byte.

export async function POST(request: Request) {
  // The RAW body. Reading it as JSON first and re-serialising changes key order
  // and whitespace, and the signature never matches again.
  const raw = await request.text();
  const event = verifyWebhook(raw, request.headers.get("stripe-signature"));

  // No detail in the response. Anyone can reach this URL, and telling them
  // whether their signature was merely wrong or their timestamp was stale is
  // free information for whoever is probing it.
  if (!event) return new Response("Bad signature", { status: 400 });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event);
        break;
      case "charge.refunded":
        await onChargeRefunded(event);
        break;
      case "account.updated":
        await onAccountUpdated(event);
        break;
      default:
        // Everything else is acknowledged and ignored. Answering 2xx to an
        // event we don't handle is correct: a 4xx would make Stripe retry it
        // forever and eventually disable the endpoint over an event that was
        // never a problem.
        break;
    }
  } catch (err) {
    // A 500 asks Stripe to retry, which is what we want for a transient
    // database failure. The handlers below are all idempotent, so a retry that
    // arrives after the first one actually succeeded does nothing twice.
    console.error("[stripe-webhook] handler failed", event.type, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

// ── A customer finished paying ──────────────────────────────────────────────
async function onCheckoutCompleted(event: StripeEvent) {
  const session = event.data.object as {
    id?: string;
    payment_status?: string;
    payment_intent?: string | null;
    metadata?: Record<string, string>;
  };
  const sessionId = session.id;
  if (!sessionId) return;

  // `completed` is not the same as `paid`. The customer has submitted the form,
  // but a delayed method can still fail afterwards, so only an actually-paid
  // session moves money on our side.
  if (session.payment_status !== "paid") return;

  const { changed, payment } = await markSessionPaid(
    sessionId,
    typeof session.payment_intent === "string" ? session.payment_intent : null,
  );

  // Already paid. Stripe delivers more than once by design, so this is the
  // normal second delivery rather than a problem - stop here rather than
  // texting anybody a second time.
  if (!changed) {
    if (!(await findPaymentBySession(sessionId))) {
      // A paid session with no row of ours at all is worth shouting about: the
      // customer's money moved and nothing here knows which job it was for.
      console.error("[stripe-webhook] paid session with no matching payment row", sessionId);
    }
    return;
  }

  const quoteId = payment?.quote_id ?? session.metadata?.quote_id;
  if (!quoteId) return;

  await addAdminEvent(quoteId, "payment_received", {
    method: "card",
    amount_cents: payment?.amount_cents ?? null,
    fee_cents: payment?.fee_cents ?? null,
    session: sessionId,
  });

  await settleJobIfPaid(quoteId);
}

// ── Money went back ─────────────────────────────────────────────────────────
async function onChargeRefunded(event: StripeEvent) {
  const charge = event.data.object as {
    payment_intent?: string | null;
    amount_refunded?: number;
  };
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!intent) return;

  // Stripe reports the running total refunded on the charge, not the delta, so
  // this is a set rather than an increment - which also makes it idempotent.
  const refunded = Number(charge.amount_refunded ?? 0);
  if (!Number.isFinite(refunded) || refunded <= 0) return;

  const res = await pgAdmin(
    `quote_payments?payment_intent_id=eq.${encodeURIComponent(intent)}&select=id,quote_id,amount_cents,refunded_cents`,
  );
  if (!res.ok) return;
  const rows = (await res.json()) as {
    id: string;
    quote_id: string;
    amount_cents: number;
    refunded_cents: number;
  }[];
  const row = rows[0];
  if (!row) return;

  // Already recorded - either this delivery is a repeat, or the office pressed
  // Refund and wrote it before Stripe's event arrived. Nothing to do and, more
  // to the point, nothing to log a second time.
  if (row.refunded_cents >= refunded) return;

  // Shared with the refund action so both write the same shape. `refunded` is
  // Stripe's running total, not a delta, which is what makes this idempotent.
  await applyRefund(row.id, refunded, row.amount_cents);
  await addAdminEvent(row.quote_id, "payment_refunded", { amount_cents: refunded, via: "stripe" });
}

// ── A contractor's account changed ──────────────────────────────────────────
// Fires when they finish onboarding, when Stripe finishes reviewing them, and
// when Stripe later asks them for something new. Keeping the cached flags
// current here is what stops the office sending a payment link to somebody
// Stripe has quietly stopped letting take money.
async function onAccountUpdated(event: StripeEvent) {
  const account = event.data.object as {
    id?: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  };
  const accountId = account.id ?? event.account;
  if (!accountId) return;

  const staff = await staffByStripeAccount(accountId);
  // An account we don't know about is not an error: the office may have created
  // it in Stripe and not linked it to a contractor yet.
  if (!staff) return;

  await saveStripeAccount(staff.id, {
    stripe_charges_enabled: Boolean(account.charges_enabled),
    stripe_payouts_enabled: Boolean(account.payouts_enabled),
    stripe_details_submitted: Boolean(account.details_submitted),
  });
}
