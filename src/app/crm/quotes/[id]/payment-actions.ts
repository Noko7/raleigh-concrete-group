"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { isRecordedMethod, usd } from "@/lib/crm/fees";
import { notifyCashRecorded, notifyPayLink } from "@/lib/crm/notify";
import {
  applyRefund,
  jobLedger,
  paymentById,
  payeeState,
  recordPayment,
  settleJobIfPaid,
} from "@/lib/crm/payments";
import { refundPayment } from "@/lib/crm/stripe";
import { addEvent, getQuote, updateQuote } from "@/lib/crm/queries";

export type PaymentState = { ok: boolean; error?: string; message?: string };

// Every screen that can move money on a job. Revalidated together because the
// crew's job page, the office's quote page and the cash board are three views
// of the same ledger, and a payment that only appears on one of them is how two
// people end up recording the same $4,000 twice.
function refreshMoneyViews(id: string) {
  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm/money");
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");
}

/** Dollars as typed by a person - "$4,000", "4000.50" - to whole cents. */
function parseAmount(raw: unknown): number | null {
  const cleaned = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// ── Text the customer a card link ───────────────────────────────────────────

/**
 * Send the customer their payment page.
 *
 * The link is the same one for the whole job, so this is safe to press twice -
 * the customer gets the same page showing whatever is currently owed, not a
 * second bill.
 */
export async function sendPayLink(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };

  const quote = await getQuote(session, id);
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  // Staff-facing, so this says exactly what is wrong and who fixes it. The
  // customer-facing version of the same failure says none of this.
  const payee = await payeeState(quote);
  if (!payee.ok) {
    const why: Record<typeof payee.reason, string> = {
      no_stripe: "Card payments aren't set up on this site yet.",
      unassigned: "Assign this job to a contractor before sending a card link.",
      not_linked: "This crew has no Stripe account linked yet. The office can add one on the Contractors page.",
      not_ready: "Stripe hasn't finished approving this crew's account, so they can't take cards yet.",
    };
    return { ok: false, error: why[payee.reason] };
  }

  const { ledger } = await jobLedger(quote);
  if (ledger.dueCents <= 0) return { ok: true, message: "Nothing to collect - this job is paid in full." };

  const sent = await notifyPayLink(
    { id, name: quote.name, phone: quote.phone, public_token: quote.public_token },
    ledger.dueCents,
  ).catch(() => null);

  await addEvent(session, id, "pay_link_sent", {
    delivered: Boolean(sent?.ok),
    to: quote.phone,
    error: sent?.ok ? null : (sent?.detail ?? "send failed"),
    due_cents: ledger.dueCents,
  });
  // Stamped whether or not the text landed: the office asked for the money, and
  // that is the fact the pipeline is tracking.
  await updateQuote(session, id, { payment_requested_at: new Date().toISOString() });

  refreshMoneyViews(id);

  if (sent?.held) {
    return { ok: true, message: `Saved. The text goes out ${sent.sendAfterLabel ?? "in the morning"}.` };
  }
  if (!sent?.ok) return { ok: false, error: "The text didn't send. Call the office." };
  return { ok: true, message: `Payment link texted to ${quote.name.split(" ")[0]}.` };
}

// ── Money the crew took in person ───────────────────────────────────────────

/**
 * Record cash, a cheque, Zelle or Venmo.
 *
 * It counts the moment it is entered - no approval step, by design. The crew is
 * standing in front of the customer and the office gets a text within seconds;
 * a queue of payments waiting to be confirmed would just mean the balance on
 * screen is wrong for a day, which is worse than trusting the person who took
 * the money.
 *
 * The office's cut is deliberately NOT collected here. Nothing moved through
 * Stripe, so the fee stays owed on the job and the contractor settles it later -
 * that debt, and its being visible, is the whole point of the cash board.
 */
export async function recordManualPayment(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };

  const quote = await getQuote(session, id);
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  const method = String(formData.get("method") ?? "");
  if (!isRecordedMethod(method)) {
    return { ok: false, error: "Pick how the customer paid." };
  }

  const amountCents = parseAmount(formData.get("amount"));
  if (amountCents === null) return { ok: false, error: "Enter how much they paid." };

  // Frozen here: this is money moving, so the rate the office earns on this job
  // is settled now and won't drift if the contractor crosses the 3-job mark
  // before the balance comes in.
  const before = await jobLedger(quote, { freeze: true });
  if (before.ledger.totalCents <= 0) {
    return { ok: false, error: "This job has no price on it yet, so there's nothing to pay against." };
  }
  if (amountCents > before.ledger.dueCents) {
    return {
      ok: false,
      error: `That's more than the ${usd(before.ledger.dueCents)} still owed. Enter the amount actually taken.`,
    };
  }

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const saved = await recordPayment(session, {
    quoteId: id,
    method,
    amountCents,
    // Nothing was collected for the office - see the note above.
    feeCents: 0,
    status: "paid",
    recordedBy: session.staff.id,
    note: note || null,
  });
  if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save that payment." };

  await addEvent(session, id, "payment_received", { method, amount_cents: amountCents, fee_cents: 0 });
  await settleJobIfPaid(id).catch(() => {});

  // Read back rather than subtracting: the alert below tells the owner what is
  // still owed, and that figure has to come from the ledger, not from arithmetic
  // done on a stale copy of it.
  const after = await jobLedger(quote);
  await notifyCashRecorded({
    q: { id, name: quote.name, phone: quote.phone, job_token: quote.job_token },
    amountCents,
    method,
    who: session.staff.full_name || "the crew",
    dueCents: after.ledger.dueCents,
    feeOwedCents: after.ledger.feeDueNowCents,
  }).catch(() => {});

  refreshMoneyViews(id);
  return {
    ok: true,
    message:
      after.ledger.dueCents > 0
        ? `${usd(amountCents)} recorded. ${usd(after.ledger.dueCents)} still to collect.`
        : `${usd(amountCents)} recorded. This job is paid in full.`,
  };
}

// ── Giving money back ───────────────────────────────────────────────────────

/**
 * Refund a card payment, and hand back the office's cut with it.
 *
 * Owner only. A refund comes out of the contractor's Stripe balance, and
 * `refundApplicationFee` is what stops it costing them the office's percentage
 * on top of the customer's money - without it a refunded job would leave the
 * crew down the fee on work they were never paid for.
 *
 * Cash is not refundable here on purpose: the office never held it, so there is
 * nothing on this system to send back. Whoever took it hands it back.
 */
export async function refundJobPayment(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!id || !paymentId) return { ok: false, error: "Missing payment." };

  const row = await paymentById(paymentId);
  if (!row || row.quote_id !== id) return { ok: false, error: "That payment isn't on this job." };
  if (row.method !== "card" || !row.payment_intent_id || !row.stripe_account_id) {
    return { ok: false, error: "Only card payments can be refunded here. Cash goes back the way it came." };
  }
  if (row.status === "refunded" || row.refunded_cents >= row.amount_cents) {
    return { ok: true, message: "That payment has already been refunded in full." };
  }

  const refundable = row.amount_cents - row.refunded_cents;
  const asked = parseAmount(formData.get("amount"));
  const amountCents = asked ?? refundable;
  if (amountCents > refundable) {
    return { ok: false, error: `The most that can go back on this payment is ${usd(refundable)}.` };
  }

  const done = await refundPayment({
    paymentIntentId: row.payment_intent_id,
    stripeAccount: row.stripe_account_id,
    amountCents,
    // Always. See the note above.
    refundApplicationFee: true,
    idempotencyKey: `rf_${row.id}_${amountCents}`,
  });
  if (!done.ok) return { ok: false, error: done.error };

  // Written here as well as by the charge.refunded webhook. Both set the running
  // total rather than adding to it, so whichever lands second changes nothing.
  await applyRefund(row.id, row.refunded_cents + amountCents, row.amount_cents);
  await addEvent(session, id, "payment_refunded", { amount_cents: amountCents });

  refreshMoneyViews(id);
  return { ok: true, message: `${usd(amountCents)} refunded to the customer.` };
}
