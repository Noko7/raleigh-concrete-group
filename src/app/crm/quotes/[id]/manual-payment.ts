import { usd, type RecordedMethod } from "@/lib/crm/fees";
import { notifyCashRecorded } from "@/lib/crm/notify";
import { jobLedger, recordPayment, settleJobIfPaid } from "@/lib/crm/payments";
import { addEvent } from "@/lib/crm/queries";
import type { Quote, Session } from "@/lib/crm/types";

/**
 * Money the crew took in person (cash, cheque, Zelle, Venmo). Shared by the payments card and phone-agreed
 * change orders so both write the same row, log entry and office text. Not a server action: callers check
 * the session and job first.
 * Counts immediately, no approval step. The office's cut is NOT collected here (nothing went through
 * Stripe); it stays owed for the contractor to settle.
 */
export async function takeManualPayment(
  session: Session,
  quote: Quote,
  input: { method: RecordedMethod; amountCents: number; note?: string | null },
): Promise<{ ok: boolean; error?: string; dueCents?: number }> {
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

  // Read back from the ledger rather than subtracting from a stale copy.
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
