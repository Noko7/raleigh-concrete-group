"use server";

import { redirect } from "next/navigation";

import { MIN_PAYMENT_CENTS, jobLedger, startJobCheckout } from "@/lib/crm/payments";
import { getQuoteByToken } from "@/lib/crm/queries";

export type PayState = { error?: string };

/**
 * Send the customer to Stripe for one payment on their job.
 *
 * Everything about the amount is re-derived here from the job, never trusted
 * from the form: the page is behind an unguessable token rather than a login,
 * so the only thing standing between a posted field and a charge is this
 * function. The form says how much they chose; the server says whether that is
 * a number this job can accept.
 */
export async function beginPayment(_prev: PayState, formData: FormData): Promise<PayState> {
  const token = String(formData.get("token") ?? "");
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) return { error: "We couldn't find that job. Please give us a call." };

  if (quote.customer_response !== "accepted" || quote.status === "lost") {
    return { error: "There's nothing to pay on this job yet." };
  }

  const raw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { error: "Enter how much you'd like to pay." };
  }
  const amountCents = Math.round(dollars * 100);
  if (amountCents < MIN_PAYMENT_CENTS) return { error: "Enter an amount of at least $1." };

  // Read once more with the fee frozen, so the ceiling below is the same figure
  // startJobCheckout will charge against.
  const { ledger, rows } = await jobLedger(quote);
  if (ledger.dueCents <= 0) return { error: "This job is already paid in full - nothing is owed." };
  if (amountCents > ledger.dueCents) {
    return { error: `The most that can be paid on this job right now is $${(ledger.dueCents / 100).toFixed(2)}.` };
  }

  // A handful of half-finished checkouts is a customer changing their mind. A
  // hundred is somebody with the link hammering the button, and each one is a
  // live Stripe session on the contractor's account.
  const openSessions = rows.filter((r) => r.status === "pending").length;
  if (openSessions >= 5) {
    return { error: "You have a payment already open. Finish or close it first, or give us a call." };
  }

  const started = await startJobCheckout({ quote, amountCents });
  if (!started.ok) return { error: started.error };

  // Outside any try/catch: redirect() works by throwing, and swallowing that
  // would leave the customer on this page with a session open and no way to it.
  redirect(started.url);
}
