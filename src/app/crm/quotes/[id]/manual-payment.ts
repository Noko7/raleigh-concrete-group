import { usd, type RecordedMethod } from "@/lib/crm/fees";
import { notifyCashRecorded } from "@/lib/crm/notify";
import { jobLedger, recordPayment, settleJobIfPaid } from "@/lib/crm/payments";
import { addEvent } from "@/lib/crm/queries";
import type { Quote, Session } from "@/lib/crm/types";

/**
 * Money the crew took in person - cash, a cheque, Zelle or Venmo - written to
 * the job's ledger.
 *
 * Shared by the payments card and by a change order the customer agreed to on
 * the phone and paid for on the spot, so both land the same row, the same log
 * entry and the same text to the office. Deliberately not a server action
 * module: callers check the session and the job first.
 *
 * It counts the moment it is entered - no approval step, by design. The office's
 * cut is NOT collected here: nothing moved through Stripe, so the fee stays owed
 * on the job and the contractor settles it later.
 */
export async function takeManualPayment(
  session: Session,
  quote: Quote,
  input: { method: RecordedMethod; amountCents: number; note?: string | null },
): Promise<{ ok: boolean; error?: string; dueCents?: number }> {
  const id = quote.id;
  // Frozen here: this is money moving, so the rate the office earns on this job
  // is settled now and won't drift if the contractor crosses the 3-job mark
  // before the balance comes in.
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

  // Read back rather than subtracting: the alert tells the owner what is still
  // owed, and that figure has to come from the ledger, not from arithmetic done
  // on a stale copy of it.
  const after = await jobLedger(quote);
  await notifyCashRecorded({
    q: { id, name: quote.name, phone: quote.phone, job_token: quote.job_token },
    amountCents: input.amountCents,
    method: input.method,
    who: session.staff.full_name || "the crew",
    dueCents: after.ledger.dueCents,
    feeOwedCents: after.ledger.feeDueNowCents,
  }).catch(() => {});

  return { ok: true, dueCents: after.ledger.dueCents };
}
