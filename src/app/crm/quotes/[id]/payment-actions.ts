"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { cleanAmount, firstNameOf } from "@/lib/crm/constants";
import { isRecordedMethod, toCents, usd } from "@/lib/crm/fees";
import { notifyPaymentCorrected, notifyPayLink } from "@/lib/crm/notify";
import {
  applyRefund,
  correctableReason,
  correctRecordedPaymentAdmin,
  jobLedger,
  listPaymentsAdmin,
  paymentById,
  payeeState,
  resyncJobPaidState,
  voidRecordedPaymentAdmin,
} from "@/lib/crm/payments";
import { refundPayment } from "@/lib/crm/stripe";
import { takeManualPayment } from "./manual-payment";
import { addEvent, getQuote, getStaffById, updateQuote } from "@/lib/crm/queries";

export type PaymentState = { ok: boolean; error?: string; message?: string };

// The crew's job page, the quote page and the cash board are three views of one
// ledger; refreshing them together stops the same payment being recorded twice.
function refreshMoneyViews(id: string) {
  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/crm/money");
  revalidatePath("/crm");
  revalidatePath("/job/[token]", "page");
}

/** Dollars as typed by a person - "$4,000", "4000.50" - to whole cents. */
function parseAmount(raw: unknown): number | null {
  const cleaned = cleanAmount(raw);
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// ── Text the customer a card link ───────────────────────────────────────────

/**
 * Text the customer their payment page. Same link for the whole job, showing
 * whatever is currently owed, so pressing twice is safe.
 */
export async function sendPayLink(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing job id." };

  const quote = await getQuote(session, id);
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  // Staff-facing: says exactly what's wrong and who fixes it (the customer
  // version doesn't).
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
  // Stamped whether or not the text landed: the request is what's tracked.
  await updateQuote(session, id, { payment_requested_at: new Date().toISOString() });

  refreshMoneyViews(id);

  if (sent?.held) {
    return { ok: true, message: `Saved. The text goes out ${sent.sendAfterLabel ?? "in the morning"}.` };
  }
  if (!sent?.ok) return { ok: false, error: "The text didn't send. Call the office." };
  return { ok: true, message: `Payment link texted to ${firstNameOf(quote.name, quote.name)}.` };
}

// ── Money the crew took in person ───────────────────────────────────────────

/**
 * Record cash, a cheque, Zelle or Venmo. Counts immediately with no approval
 * step: the office is texted within seconds, and a confirmation queue would
 * just leave balances wrong for a day.
 *
 * The office's cut is NOT collected here: nothing went through Stripe, so the
 * fee stays owed for the contractor to settle (what the cash board tracks).
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

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const taken = await takeManualPayment(session, quote, { method, amountCents, note });
  if (!taken.ok) return { ok: false, error: taken.error ?? "Could not save that payment." };
  const dueCents = taken.dueCents ?? 0;

  refreshMoneyViews(id);
  return {
    ok: true,
    message:
      dueCents > 0
        ? `${usd(amountCents)} recorded. ${usd(dueCents)} still to collect.`
        : `${usd(amountCents)} recorded. This job is paid in full.`,
  };
}

// ── Giving money back ───────────────────────────────────────────────────────

/**
 * Refund a card payment and hand back the office's cut. Owner only.
 * `refundApplicationFee` keeps the refund from costing the contractor the
 * office's percentage on top. Cash isn't refundable here: the office never held
 * it.
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
    // Always; see above.
    refundApplicationFee: true,
    idempotencyKey: `rf_${row.id}_${amountCents}`,
  });
  if (!done.ok) return { ok: false, error: done.error };

  // Also written by the charge.refunded webhook. Both set the running total, so
  // whichever lands second is a no-op.
  await applyRefund(row.id, row.refunded_cents + amountCents, row.amount_cents);
  await addEvent(session, id, "payment_refunded", { amount_cents: amountCents });

  refreshMoneyViews(id);
  return { ok: true, message: `${usd(amountCents)} refunded to the customer.` };
}

// ── Fixing a payment somebody keyed in wrong ────────────────────────────────
// Owner only: the cash board settles from these rows, so contractors can't
// restate their own entries (least-privilege.sql); the crew get told.
// Not refunds: no money moved wrongly, the row is just wrong, and a refund would
// add a fake outgoing to a ledger reconciled against the bank.

/**
 * Correct the amount, method or note on a hand-recorded payment, e.g. a 50%
 * deposit recorded as the whole job (the amount box pre-fills with the balance).
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

  // Nothing came in at all: a payment row can't be $0 (the DB refuses it), so
  // point them to voiding instead of a confusing refusal.
  const typed = cleanAmount(formData.get("amount"));
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

  // Same ceiling as a new payment, measured against the job's OTHER rows, so
  // correcting $8,250 down to $4,125 isn't refused by its own old figure.
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

  // Both figures, so the log shows whether the books moved $5 or $4,000.
  await addEvent(session, id, "payment_corrected", {
    payment_id: row.id,
    from_cents: row.amount_cents,
    to_cents: amountCents,
    from_method: row.method,
    to_method: method,
    note: note || null,
  });

  // Re-derive paid state both ways, or a wrong stamp keeps the job off
  // "customers still owe" (or a correction upward fails to settle it).
  await resyncJobPaidState(id).catch(() => {});

  const after = await jobLedger(quote);
  // The crew act on what's left to collect and what they owe the office. The
  // owner made the change, so isn't texted.
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
 * Take a payment off the books (duplicate, wrong job). Not deleted: kept as
 * voided with the reason, for reconciliation. Totals only sum 'paid' and
 * 'refunded' rows, so it stops counting everywhere.
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

  // Required and stored on the row: an unexplained void is a hole in the books.
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
    // Voided, not reduced; the text says so.
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

// ── Waiving part of the office fee ──────────────────────────────────────────

/**
 * Waive some or all of the office fee on one job (e.g. materials passed through
 * at cost). Owner only, also enforced by the DB. Sets rather than adds, so a new
 * figure replaces the old and 0 clears it.
 */
export async function setFeeWaiver(_prev: PaymentState, formData: FormData): Promise<PaymentState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "");
  const quote = id ? await getQuote(session, id) : null;
  if (!quote) return { ok: false, error: "You don't have access to this job." };

  const typed = cleanAmount(formData.get("amount"));
  const dollars = typed === "" ? 0 : Number(typed);
  if (!Number.isFinite(dollars) || dollars < 0) return { ok: false, error: "Enter the amount to waive, or 0 to clear it." };
  const cents = Math.round(dollars * 100);

  // Against the full fee before any waiver: the most there is to take off.
  const { ledger } = await jobLedger({ ...quote, fee_waived_cents: 0 });
  if (cents > ledger.feeTotalCents) {
    return { ok: false, error: `That's more than the whole ${usd(ledger.feeTotalCents)} fee on this job.` };
  }

  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const before = Number(quote.fee_waived_cents ?? 0);
  const saved = await updateQuote(session, id, { fee_waived_cents: cents, fee_waived_note: cents > 0 ? note : null });
  if (!saved) return { ok: false, error: "Could not save that. Run supabase/fee-waiver.sql and try again." };

  await addEvent(session, id, "fee_waived", { from_cents: before, to_cents: cents, note });
  refreshMoneyViews(id);
  return {
    ok: true,
    message: cents > 0 ? `${usd(cents)} of your fee waived on this job.` : "Fee waiver cleared.",
  };
}
