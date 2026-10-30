import { addAdminEvent } from "@/lib/crm/queries";
import {
  applyRefund,
  findPaymentBySession,
  markSessionPaid,
  saveStripeAccount,
  settleJobIfPaid,
  staffByStripeAccount,
} from "@/lib/crm/payments";
import { receiptForNewPayment } from "@/lib/crm/receipts";
import { verifyWebhook, type StripeEvent } from "@/lib/crm/stripe";
import { pgAdmin } from "@/lib/crm/rest";

// Under /api, not /crm/api: the CRM middleware 307s cookieless requests to login, which Stripe counts as
// failures and eventually disables the endpoint.
// Direct charges belong to the connected account, so the endpoint must be configured with "Events from:
// Connected accounts" to receive checkout.session.completed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node, not Edge: needs node:crypto HMAC and the byte-exact raw body.

export async function POST(request: Request) {
  // RAW body: re-serialised JSON never matches the signature.
  const raw = await request.text();
  const event = verifyWebhook(raw, request.headers.get("stripe-signature"));

  // No detail: don't tell a prober which part of the check failed.
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
        // 2xx for unhandled events: a 4xx makes Stripe retry and eventually disable the endpoint.
        break;
    }
  } catch (err) {
    // 500 asks Stripe to retry (transient DB failures). Handlers are idempotent.
    console.error("[stripe-webhook] handler failed", event.type, err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function onCheckoutCompleted(event: StripeEvent) {
  const session = event.data.object as {
    id?: string;
    payment_status?: string;
    payment_intent?: string | null;
    metadata?: Record<string, string>;
  };
  const sessionId = session.id;
  if (!sessionId) return;

  // `completed` is not `paid`: delayed methods can still fail.
  if (session.payment_status !== "paid") return;

  const { changed, payment } = await markSessionPaid(
    sessionId,
    typeof session.payment_intent === "string" ? session.payment_intent : null,
  );

  // Stripe redelivers by design; don't text anyone twice.
  if (!changed) {
    if (!(await findPaymentBySession(sessionId))) {
      // The customer's money moved and nothing knows which job it was for.
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

  // Card payments get a receipt like any other; the customer's copy always goes (no box to untick online),
  // and no payment text has told the owner yet. The return page may have issued it first: then nothing is sent.
  if (payment?.id) await receiptForNewPayment({ paymentId: payment.id, customerCopy: true, ownerAlreadyTold: false });
}

async function onChargeRefunded(event: StripeEvent) {
  const charge = event.data.object as {
    payment_intent?: string | null;
    amount_refunded?: number;
  };
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!intent) return;

  // Stripe reports the running total refunded, not the delta, so this is a set (idempotent).
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

  // Already recorded (repeat delivery, or the Refund action got there first): don't log twice.
  if (row.refunded_cents >= refunded) return;

  // Shared with the refund action so both write the same shape.
  await applyRefund(row.id, refunded, row.amount_cents);
  await addAdminEvent(row.quote_id, "payment_refunded", { amount_cents: refunded, via: "stripe" });
}

// Fires on onboarding, review, and later Stripe requests. Keeps cached flags current so no payment link
// goes to an account that can't take money.
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
  // Not an error: the account may not be linked to a contractor yet.
  if (!staff) return;

  await saveStripeAccount(staff.id, {
    stripe_charges_enabled: Boolean(account.charges_enabled),
    stripe_payouts_enabled: Boolean(account.payouts_enabled),
    stripe_details_submitted: Boolean(account.details_submitted),
  });
}
