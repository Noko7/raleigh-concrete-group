"use server";

import { redirect } from "next/navigation";

import { cleanAmount } from "@/lib/crm/constants";
import { MIN_PAYMENT_CENTS, jobLedger, startJobCheckout } from "@/lib/crm/payments";
import { getQuoteByToken } from "@/lib/crm/queries";

export type PayState = { error?: string };

/**
 * Send the customer to Stripe for one payment. The amount is re-derived from
 * the job, never trusted from the form: the page is behind a token, not a
 * login, so this function is all that stands between a posted field and a charge.
 */
export async function beginPayment(_prev: PayState, formData: FormData): Promise<PayState> {
  const token = String(formData.get("token") ?? "");
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) return { error: "We couldn't find that job. Please give us a call." };

  if (quote.customer_response !== "accepted" || quote.status === "lost") {
    return { error: "There's nothing to pay on this job yet." };
  }

  const raw = cleanAmount(formData.get("amount"));
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { error: "Enter how much you'd like to pay." };
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents < MIN_PAYMENT_CENTS) return { error: "Enter an amount of at least $1." };

  // Read WITHOUT freezing: validating a typed amount must not commit the
  // contractor to today's rate; startJobCheckout freezes when money moves.
  // previewFee and ensureFeeOnJob derive the same rate, so the ceiling matches.
  const { ledger, rows } = await jobLedger(quote);
  if (ledger.dueCents <= 0) return { error: "This job is already paid in full - nothing is owed." };
  if (amountCents > ledger.dueCents) {
    return { error: `The most that can be paid on this job right now is $${(ledger.dueCents / 100).toFixed(2)}.` };
  }

  // Many open checkouts means someone hammering the link, each a live Stripe
  // session on the contractor's account.
  const openSessions = rows.filter((r) => r.status === "pending").length;
  if (openSessions >= 5) {
    return { error: "You have a payment already open. Finish or close it first, or give us a call." };
  }

  const started = await startJobCheckout({ quote, amountCents });
  if (!started.ok) return { error: started.error };

  // Outside any try/catch: redirect() throws, and swallowing it strands the customer.
  redirect(started.url);
}
