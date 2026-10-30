import { usd, type RecordedMethod } from "@/lib/crm/fees";
import { notifyCashRecorded } from "@/lib/crm/notify";
import { jobLedger, recordPayment, settleJobIfPaid } from "@/lib/crm/payments";
import { receiptNumberLabel } from "@/lib/crm/receipt-format";
import { receiptForNewPayment } from "@/lib/crm/receipts";
import { addEvent } from "@/lib/crm/queries";
import type { Quote, Session } from "@/lib/crm/types";

/**
 * The "Text the customer a receipt" box. Ticked by default; a form from before the box existed (an open tab
 * on an old page) has no box at all, and gets the default rather than reading as unticked.
 */
export function customerReceiptChoice(formData: FormData): boolean {
  if (!formData.has("receipt_box")) return true;
  return formData.get("send_receipt") === "on";
}

/**
 * Money the crew took in person (cash, cheque, Zelle, Venmo). Shared by the payments card and phone-agreed
 * change orders so both write the same row, log entry and office text. Not a server action: callers check
 * the session and job first.
 * Counts immediately, no approval step. The office's cut is NOT collected here (nothing went through
 * Stripe); it stays owed for the contractor to settle.
 * Issues the payment's receipt: the contractor is texted their copy, the owner's copy rides the payment
 * text below, and the customer gets one when `customerCopy` (the form's box, ticked by default).
 */
export async function takeManualPayment(
  session: Session,
  quote: Quote,
  input: { method: RecordedMethod; amountCents: number; note?: string | null; customerCopy: boolean },
): Promise<{ ok: boolean; error?: string; dueCents?: number; receiptNumber?: number }> {
  const id = quote.id;
  // Freeze the rate now so it can't drift if the contractor crosses the 3-job mark before the balance comes in.
  const before = await jobLedger(quote, { freeze: true });
  if (before.ledger.totalCents <= 0) {
    return { ok: false, error: "This job has no price on it yet, so there's nothing to pay against." };
  }
  if (input.amountCents > before.ledger.dueCents) {
    return {
      ok: false,
      error: `That's more than the ${usd(before.ledger.dueCents)} still owed. Enter the amount actually taken.`,
    };
  }

  const saved = await recordPayment(session, {
    quoteId: id,
    method: input.method,
    amountCents: input.amountCents,
    feeCents: 0,
    status: "paid",
    recordedBy: session.staff.id,
    note: input.note || null,
  });
  if (!saved.ok) return { ok: false, error: saved.error ?? "Could not save that payment." };

  await addEvent(session, id, "payment_received", { method: input.method, amount_cents: input.amountCents, fee_cents: 0 });
  await settleJobIfPaid(id).catch(() => {});

  const receipt = saved.payment
    ? await receiptForNewPayment({ paymentId: saved.payment.id, customerCopy: input.customerCopy, ownerAlreadyTold: true })
    : null;

  // Read back from the ledger rather than subtracting from a stale copy.
  const after = await jobLedger(quote);
  await notifyCashRecorded({
    q: { id, name: quote.name, phone: quote.phone, job_token: quote.job_token },
    amountCents: input.amountCents,
    method: input.method,
    who: session.staff.full_name || "the crew",
    dueCents: after.ledger.dueCents,
    feeOwedCents: after.ledger.feeDueNowCents,
    receipt: receipt ? { number: receiptNumberLabel(receipt.receipt_number), token: receipt.token } : null,
  }).catch(() => {});

  return { ok: true, dueCents: after.ledger.dueCents, receiptNumber: receipt?.receipt_number };
}
