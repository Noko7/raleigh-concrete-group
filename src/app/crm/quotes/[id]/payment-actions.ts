"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { isRecordedMethod, toCents, usd } from "@/lib/crm/fees";
import { notifyCashRecorded, notifyPaymentCorrected, notifyPayLink } from "@/lib/crm/notify";
import {
  applyRefund,
  correctableReason,
  correctRecordedPaymentAdmin,
  jobLedger,
  listPaymentsAdmin,
  paymentById,
  payeeState,
  recordPayment,
  resyncJobPaidState,
  settleJobIfPaid,
  voidRecordedPaymentAdmin,
} from "@/lib/crm/payments";
import { refundPayment } from "@/lib/crm/stripe";
import { addEvent, getQuote, getStaffById, updateQuote } from "@/lib/crm/queries";

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

// ── Fixing a payment somebody keyed in wrong ────────────────────────────────
// Owner only, both of these. A contractor restating their own entry is exactly
// what least-privilege.sql exists to prevent - the cash board is settled from
// these rows - so the office does the correcting and the crew get told.
//
// Neither of these is a refund. No money moved wrongly: the figure on the row
// is not what happened. A refund would put an imaginary outgoing on a ledger
// that gets reconciled against a bank statement.

/**
 * Correct the amount, method or note on a hand-recorded payment.
 *
 * The case this was built for: a 50% deposit recorded as the whole job. Nothing
 * refused it - the form's amount box is pre-filled with the outstanding balance,
 * and on an untouched job that is the full total - and until now nothing could
 * put it right without opening the Supabase console.
 */
export async function correctRecordedPayment(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!id || !paymentId) return { ok: false, error: "Missing payment." };

  const quote = await getQuote(session, id);
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  const row = await paymentById(paymentId);
  if (!row || row.quote_id !== id) return { ok: false, error: "That payment isn't on this job." };
  const blocked = correctableReason(row);
  if (blocked) return { ok: false, error: blocked };

  // Nothing came in at all - no deposit, the crew recorded money that was never
  // handed over. Typing 0 here is the obvious move and it cannot work: a payment
  // row is never $0 (the database refuses it, and a $0 payment would be a row
  // that says money arrived when none did). The honest answer is that the row
  // should not exist, which is what voiding is for - so say so, rather than
  // refusing with "enter what they paid" to somebody who just did.
  const typed = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  if (typed !== "" && Number(typed) === 0) {
    return {
      ok: false,
      error: 'If nothing came in at all, don\'t correct it to $0 - use "Take this off the books" below. A payment can\'t be zero.',
    };
  }

  const amountCents = parseAmount(formData.get("amount"));
  if (amountCents === null) return { ok: false, error: "Enter what they actually paid." };

  const method = String(formData.get("method") ?? row.method);
  if (!isRecordedMethod(method)) return { ok: false, error: "Pick how the customer paid." };

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  // Same ceiling a new payment has: never more than the job is worth. Measured
  // against the job's OTHER rows, so this one is not weighed against itself -
  // without that, correcting $8,250 down to $4,125 would be refused for
  // exceeding a balance that the $8,250 itself was filling.
  const rows = await listPaymentsAdmin(id);
  const elsewhere = rows
    .filter((r) => r.id !== row.id && (r.status === "paid" || r.status === "refunded"))
    .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);
  const totalCents = toCents(quote.quote_amount);
  if (totalCents > 0 && elsewhere + amountCents > totalCents) {
    const room = Math.max(0, totalCents - elsewhere);
    return {
      ok: false,
      error: `That would collect more than the job is worth. The most this payment can be is ${usd(room)}.`,
    };
  }

  const unchanged =
    amountCents === row.amount_cents && method === row.method && note === (row.note ?? "").trim();
  if (unchanged) return { ok: true, message: "Nothing changed on that payment." };

  const saved = await correctRecordedPaymentAdmin(row, { amountCents, method, note: note || null });
  if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save that correction." };

  // Both figures on the row, because "corrected a payment" tells nobody whether
  // the books moved by five dollars or four thousand.
  await addEvent(session, id, "payment_corrected", {
    payment_id: row.id,
    from_cents: row.amount_cents,
    to_cents: amountCents,
    from_method: row.method,
    to_method: method,
    note: note || null,
  });

  // The stamp the wrong figure earned has to come off, or the job stays out of
  // "customers still owe" on the Money page forever. Goes both ways - a
  // correction upward can finish paying a job off.
  await resyncJobPaidState(id).catch(() => {});

  const after = await jobLedger(quote);
  // The crew are told because it changes two numbers they act on: what is left
  // to collect, and what they owe the office. The owner did it, so they are not
  // texted their own click.
  const contractor = quote.assigned_to ? await getStaffById(session, quote.assigned_to) : null;
  await notifyPaymentCorrected({
    q: { id, name: quote.name, phone: quote.phone, job_token: quote.job_token },
    contractorPhone: contractor?.phone,
    actorPhone: session.staff.phone,
    fromCents: row.amount_cents,
    toCents: amountCents,
    method,
    who: session.staff.full_name || "the office",
    dueCents: after.ledger.dueCents,
    feeOwedCents: after.ledger.feeDueNowCents,
  }).catch(() => {});

  refreshMoneyViews(id);
  return {
    ok: true,
    message:
      after.ledger.dueCents > 0
        ? `Corrected to ${usd(amountCents)}. ${usd(after.ledger.dueCents)} still to collect.`
        : `Corrected to ${usd(amountCents)}. This job is paid in full.`,
  };
}

/**
 * Take a payment off the books entirely - a duplicate, or one recorded against
 * the wrong job.
 *
 * The row is not deleted. It stays visible as voided with the reason on it,
 * because "what happened to that $8,250" gets asked exactly when somebody is
 * reconciling a month, and a deleted row cannot answer it. Every total in the
 * business sums rows that are 'paid' or 'refunded', so a voided one stops
 * counting everywhere at once.
 */
export async function voidRecordedPayment(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!id || !paymentId) return { ok: false, error: "Missing payment." };

  const quote = await getQuote(session, id);
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  const row = await paymentById(paymentId);
  if (!row || row.quote_id !== id) return { ok: false, error: "That payment isn't on this job." };
  const blocked = correctableReason(row);
  if (blocked) return { ok: false, error: blocked };

  // Required, and it rides on the row. A voided payment with no reason is a
  // hole in the books that somebody will have to come back and ask about.
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (reason.length < 3) return { ok: false, error: "Say why it's being voided - it goes on the record." };

  const done = await voidRecordedPaymentAdmin(row, reason);
  if (!done.ok) return { ok: false, error: done.error ?? "Could not void that payment." };

  await addEvent(session, id, "payment_voided", {
    payment_id: row.id,
    amount_cents: row.amount_cents,
    method: row.method,
    reason,
    from_note: row.note ?? null,
  });

  await resyncJobPaidState(id).catch(() => {});

  const after = await jobLedger(quote);
  const contractor = quote.assigned_to ? await getStaffById(session, quote.assigned_to) : null;
  await notifyPaymentCorrected({
    q: { id, name: quote.name, phone: quote.phone, job_token: quote.job_token },
    contractorPhone: contractor?.phone,
    actorPhone: session.staff.phone,
    fromCents: row.amount_cents,
    // Voided, not reduced. The text says so rather than claiming it became zero.
    toCents: null,
    method: row.method,
    who: session.staff.full_name || "the office",
    dueCents: after.ledger.dueCents,
    feeOwedCents: after.ledger.feeDueNowCents,
  }).catch(() => {});

  refreshMoneyViews(id);
  return {
    ok: true,
    message: `${usd(row.amount_cents)} taken off the books. ${usd(after.ledger.dueCents)} still to collect.`,
  };
}
