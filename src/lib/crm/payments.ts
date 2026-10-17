// Server-only payment ledger access. pgUser wherever a session exists so RLS scopes the read; pgAdmin only
// where there is none (the customer's payment page, the Stripe webhook).
import { SITE_ORIGIN } from "./env";
import {
  applicationFeeFor,
  applySettlements,
  feeRateFor,
  feeTotalCents,
  readLedger,
  toCents,
  type Ledger,
} from "./fees";
import { addAdminEvent } from "./queries";
import { pgAdmin, pgUser } from "./rest";
import {
  createCheckoutSession,
  expireCheckoutSession,
  getCheckoutSession,
  STRIPE_READY,
} from "./stripe";
import type { FeeSettlement, Quote, QuotePayment, Session, Staff } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function listPayments(session: Session, quoteId: string): Promise<QuotePayment[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const res = await pgUser(
    `quote_payments?quote_id=eq.${quoteId}&select=*&order=created_at.asc`,
    session.accessToken,
  );
  // Any failure reads as "no payments yet".
  if (!res.ok) {
    console.error("[payments] list failed", quoteId, res.status);
    return [];
  }
  return (await res.json()) as QuotePayment[];
}

/** Service-role read, for the customer's payment page and the webhook. */
export async function listPaymentsAdmin(quoteId: string): Promise<QuotePayment[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const res = await pgAdmin(`quote_payments?quote_id=eq.${quoteId}&select=*&order=created_at.asc`);
  if (!res.ok) {
    console.error("[payments] list failed", quoteId, res.status);
    return [];
  }
  return (await res.json()) as QuotePayment[];
}

export function ledgerOf(quote: Quote, rows: QuotePayment[]): Ledger {
  return readLedger(toCents(quote.quote_amount), quote.fee_total_cents, rows, quote.fee_rate, quote.fee_waived_cents);
}

/**
 * Counts jobs with at least one paid row, not payments. Excludes the job being priced, so a contractor's
 * fourth job is the first at the standard rate.
 */
export async function paidJobCountFor(staffId: string, excludeQuoteId?: string): Promise<number> {
  if (!UUID_RE.test(staffId)) return 0;
  const res = await pgAdmin(
    `quote_payments?status=eq.paid&select=quote_id,quote_requests!inner(assigned_to)` +
      `&quote_requests.assigned_to=eq.${staffId}`,
  );
  if (!res.ok) return 0;
  const rows = (await res.json()) as { quote_id: string }[];
  const jobs = new Set(rows.map((r) => r.quote_id));
  if (excludeQuoteId) jobs.delete(excludeQuoteId);
  return jobs.size;
}

/**
 * Freeze the office's rate on this job the first time money is about to move. A job that already has a
 * rate is returned untouched: a job that has taken a payment must never be repriced.
 * The total can still change later; the fee is recomputed from the frozen RATE and the current total.
 */
export async function ensureFeeOnJob(quote: Quote): Promise<{ rate: number; feeTotalCents: number }> {
  const totalCents = toCents(quote.quote_amount);

  if (quote.fee_rate != null && quote.fee_total_cents != null) {
    const rate = Number(quote.fee_rate);
    // The rate is the promise; the fee follows today's total.
    return { rate, feeTotalCents: feeTotalCents(totalCents, rate) };
  }

  const paidJobs = quote.assigned_to ? await paidJobCountFor(quote.assigned_to, quote.id) : 0;
  const rate = feeRateFor(paidJobs);
  const total = feeTotalCents(totalCents, rate);

  await pgAdmin(`quote_requests?id=eq.${quote.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ fee_rate: rate, fee_total_cents: total }),
  }).catch(() => {});

  return { rate, feeTotalCents: total };
}

export type NewPayment = {
  quoteId: string;
  method: string;
  amountCents: number;
  feeCents?: number;
  status?: "pending" | "paid";
  stripeAccountId?: string | null;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  recordedBy?: string | null;
  note?: string | null;
};

function paymentRow(p: NewPayment): Record<string, unknown> {
  const status = p.status ?? "paid";
  return {
    quote_id: p.quoteId,
    method: p.method,
    amount_cents: p.amountCents,
    fee_cents: p.feeCents ?? 0,
    status,
    stripe_account_id: p.stripeAccountId ?? null,
    checkout_session_id: p.checkoutSessionId ?? null,
    payment_intent_id: p.paymentIntentId ?? null,
    recorded_by: p.recordedBy ?? null,
    note: p.note ?? null,
    // A pending card row is stamped by the webhook when the money actually arrives.
    paid_at: status === "paid" ? new Date().toISOString() : null,
  };
}

/** Insert as the signed-in user; RLS keeps a contractor to their own jobs. */
export async function recordPayment(
  session: Session,
  p: NewPayment,
): Promise<{ ok: boolean; error?: string; payment?: QuotePayment }> {
  const res = await pgUser("quote_payments", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(paymentRow(p)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[payments] record failed", p.quoteId, res.status, detail);
    return { ok: false, error: "Could not save that payment. Please try again." };
  }
  const rows = (await res.json()) as QuotePayment[];
  return { ok: true, payment: rows[0] };
}

/** Service-role insert, for rows the webhook and the customer's page create. */
export async function recordPaymentAdmin(p: NewPayment): Promise<QuotePayment | null> {
  const res = await pgAdmin("quote_payments", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(paymentRow(p)),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as QuotePayment[];
  return rows[0] ?? null;
}

/**
 * Mark a pending card payment paid, keyed by Checkout Session. Conditional on the row still being pending
 * because Stripe redelivers events. Returns whether this call changed it.
 */
export async function markSessionPaid(
  sessionId: string,
  paymentIntentId: string | null,
): Promise<{ changed: boolean; payment?: QuotePayment }> {
  const res = await pgAdmin(
    `quote_payments?checkout_session_id=eq.${encodeURIComponent(sessionId)}&status=eq.pending`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_intent_id: paymentIntentId,
      }),
    },
  );
  if (!res.ok) return { changed: false };
  const rows = (await res.json()) as QuotePayment[];
  return { changed: rows.length > 0, payment: rows[0] };
}

export async function paymentById(id: string): Promise<QuotePayment | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await pgAdmin(`quote_payments?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as QuotePayment[])[0] ?? null;
}

/**
 * Writes the refunded running TOTAL (as Stripe reports it), never an increment: the refund action and the
 * charge.refunded webhook both fire for one refund.
 */
export async function applyRefund(
  paymentId: string,
  refundedCents: number,
  amountCents: number,
): Promise<void> {
  if (!UUID_RE.test(paymentId)) return;
  const total = Math.min(Math.max(0, Math.round(refundedCents)), amountCents);
  await pgAdmin(`quote_payments?id=eq.${paymentId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      refunded_cents: total,
      refunded_at: new Date().toISOString(),
      status: total >= amountCents ? "refunded" : "paid",
    }),
  });
}

export async function findPaymentBySession(sessionId: string): Promise<QuotePayment | null> {
  const res = await pgAdmin(
    `quote_payments?checkout_session_id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`,
  );
  if (!res.ok) return null;
  return ((await res.json()) as QuotePayment[])[0] ?? null;
}

export async function saveStripeAccount(
  staffId: string,
  patch: {
    stripe_account_id?: string | null;
    stripe_charges_enabled?: boolean;
    stripe_payouts_enabled?: boolean;
    stripe_details_submitted?: boolean;
  },
): Promise<boolean> {
  if (!UUID_RE.test(staffId)) return false;
  const res = await pgAdmin(`staff?id=eq.${staffId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, stripe_checked_at: new Date().toISOString() }),
  });
  return res.ok;
}

/** The webhook's way back from acct_ to staff. */
export async function staffByStripeAccount(accountId: string): Promise<Staff | null> {
  const res = await pgAdmin(`staff?stripe_account_id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as Staff[])[0] ?? null;
}

/** Service-role read, for token-gated pages. */
export async function payeeFor(staffId: string | null | undefined): Promise<Staff | null> {
  if (!staffId || !UUID_RE.test(staffId)) return null;
  const res = await pgAdmin(`staff?id=eq.${staffId}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as Staff[])[0] ?? null;
}

export async function listSettlements(session: Session, staffId?: string): Promise<FeeSettlement[]> {
  const filter = staffId && UUID_RE.test(staffId) ? `&staff_id=eq.${staffId}` : "";
  const res = await pgUser(
    `fee_settlements?select=*${filter}&order=created_at.desc&limit=200`,
    session.accessToken,
  );
  if (!res.ok) return [];
  return (await res.json()) as FeeSettlement[];
}

export async function recordSettlement(
  session: Session,
  input: { staffId: string; quoteId?: string | null; amountCents: number; method: string; note?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const res = await pgUser("fee_settlements", session.accessToken, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      staff_id: input.staffId,
      quote_id: input.quoteId ?? null,
      amount_cents: input.amountCents,
      method: input.method,
      note: input.note ?? null,
      recorded_by: session.staff.id,
    }),
  });
  if (!res.ok) return { ok: false, error: "Could not record that settlement." };
  return { ok: true };
}

// Stripe Checkout Sessions expire after 24h; a pending row past that can never be paid and would keep
// part of the fee reserved.
const PENDING_EXPIRY_HOURS = 26;

/** Safe to call often. */
async function expireStalePending(quoteId: string): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_HOURS * 3600_000).toISOString();
  await pgAdmin(
    `quote_payments?quote_id=eq.${quoteId}&status=eq.pending&created_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed" }),
    },
  ).catch(() => {});
}

/** Read-only fee preview: shows the figure without freezing today's rate. */
async function previewFee(quote: Quote): Promise<{ rate: number; feeTotalCents: number }> {
  const totalCents = toCents(quote.quote_amount);
  if (quote.fee_rate != null) {
    const rate = Number(quote.fee_rate);
    return { rate, feeTotalCents: feeTotalCents(totalCents, rate) };
  }
  const paidJobs = quote.assigned_to ? await paidJobCountFor(quote.assigned_to, quote.id) : 0;
  const rate = feeRateFor(paidJobs);
  return { rate, feeTotalCents: feeTotalCents(totalCents, rate) };
}

/** Pass `freeze` only where a payment is about to happen, so viewing a payment page doesn't lock in a rate. */
export async function jobLedger(
  quote: Quote,
  opts: { freeze?: boolean } = {},
): Promise<{ ledger: Ledger; rows: QuotePayment[]; rate: number }> {
  await expireStalePending(quote.id);
  const fee = opts.freeze ? await ensureFeeOnJob(quote) : await previewFee(quote);
  const [rows, settledCents] = await Promise.all([listPaymentsAdmin(quote.id), settledOnJob(quote.id)]);
  return {
    // Net of fee already settled for this job; see applySettlements for why it happens here, not in readLedger.
    ledger: applySettlements(
      readLedger(toCents(quote.quote_amount), fee.feeTotalCents, rows, null, quote.fee_waived_cents),
      settledCents,
    ),
    rows,
    rate: fee.rate,
  };
}

/** In cents. */
async function settledOnJob(quoteId: string): Promise<number> {
  if (!UUID_RE.test(quoteId)) return 0;
  const res = await pgAdmin(`fee_settlements?quote_id=eq.${quoteId}&select=amount_cents`);
  // Missing table or any read failure reads as nothing settled.
  if (!res.ok) return 0;
  const rows = (await res.json()) as { amount_cents: number }[];
  return rows.reduce((sum, r) => sum + (Number(r.amount_cents) || 0), 0);
}

export type PayeeState =
  | { ok: true; staff: Staff; account: string }
  | { ok: false; reason: "unassigned" | "not_linked" | "not_ready" | "no_stripe" };

/**
 * Four reasons rather than a boolean: each needs a different fix (assign the job, link an account, finish
 * Stripe onboarding, set STRIPE_PRIV_KEY).
 */
export async function payeeState(quote: Quote): Promise<PayeeState> {
  if (!STRIPE_READY) return { ok: false, reason: "no_stripe" };
  if (!quote.assigned_to) return { ok: false, reason: "unassigned" };
  const staff = await payeeFor(quote.assigned_to);
  if (!staff?.stripe_account_id) return { ok: false, reason: "not_linked" };
  if (!staff.stripe_charges_enabled) return { ok: false, reason: "not_ready" };
  return { ok: true, staff, account: staff.stripe_account_id };
}

/** Below this, the card fee eats most of what is collected. */
export const MIN_PAYMENT_CENTS = 100;

/**
 * Session first, because the row is keyed by its id; if the row then fails to write the session is expired
 * so it can't be paid. A paid session with no row is money the webhook cannot attach to a job.
 */
export async function startJobCheckout(input: {
  quote: Quote;
  amountCents: number;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { quote } = input;

  const payee = await payeeState(quote);
  if (!payee.ok) {
    return {
      ok: false,
      error:
        payee.reason === "not_ready"
          ? "Card payments aren't switched on for this crew yet. Give us a call and we'll take it another way."
          : "Card payments aren't available on this job. Give us a call and we'll sort it out.",
    };
  }

  // Frozen here: this is the moment money moves.
  const { ledger } = await jobLedger(quote, { freeze: true });

  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents < MIN_PAYMENT_CENTS) {
    return { ok: false, error: "Enter an amount of at least $1." };
  }
  if (ledger.dueCents <= 0) {
    return { ok: false, error: "This job is already paid in full." };
  }
  if (amountCents > ledger.dueCents) {
    return { ok: false, error: "That's more than the balance left on this job." };
  }

  // Only what is left after checkouts already in flight; see readLedger.
  const applicationFeeCents = applicationFeeFor(amountCents, ledger.feeChargeableCents);

  const created = await createCheckoutSession({
    stripeAccount: payee.account,
    amountCents,
    applicationFeeCents,
    description: `${quote.service || "Concrete work"} - ${quote.address || quote.name}`,
    customerEmail: quote.email,
    successUrl: `${SITE_ORIGIN}/pay/${quote.public_token}?done={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${SITE_ORIGIN}/pay/${quote.public_token}?back=1`,
    metadata: { quote_id: quote.id },
    // Fresh key per attempt: it guards a double tap, and a job-derived key would hand a second instalment the
    // first session again.
    idempotencyKey: `chk_${quote.id}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  });

  if (!created.ok) {
    console.error("[payments] checkout failed", quote.id, created.error);
    return { ok: false, error: "We couldn't start the payment. Please try again, or give us a call." };
  }
  const session = created.data;
  if (!session.url) {
    await expireCheckoutSession(session.id, payee.account);
    return { ok: false, error: "We couldn't start the payment. Please give us a call." };
  }

  const row = await recordPaymentAdmin({
    quoteId: quote.id,
    method: "card",
    amountCents,
    feeCents: applicationFeeCents,
    status: "pending",
    stripeAccountId: payee.account,
    checkoutSessionId: session.id,
  });

  if (!row) {
    await expireCheckoutSession(session.id, payee.account);
    console.error("[payments] could not record pending payment; session expired", session.id);
    return { ok: false, error: "We couldn't start the payment. Please try again." };
  }

  return { ok: true, url: session.url };
}

/**
 * The customer's "thank you" page check, racing the webhook (and covering a misconfigured endpoint).
 * Idempotent via the same conditional update the webhook uses.
 */
export async function reconcileCheckout(sessionId: string): Promise<QuotePayment | null> {
  const row = await findPaymentBySession(sessionId);
  if (!row) return null;
  if (row.status !== "pending" || !row.stripe_account_id) return row;

  const found = await getCheckoutSession(sessionId, row.stripe_account_id);
  if (!found.ok || found.data.payment_status !== "paid") return row;

  const intent = typeof found.data.payment_intent === "string" ? found.data.payment_intent : null;
  const { changed, payment } = await markSessionPaid(sessionId, intent);
  if (!changed) return payment ?? row;

  await addAdminEvent(row.quote_id, "payment_received", {
    method: "card",
    amount_cents: row.amount_cents,
    fee_cents: row.fee_cents,
    session: sessionId,
    via: "return",
  });
  await settleJobIfPaid(row.quote_id);
  return payment ?? row;
}

/**
 * Stamp paid_at once the whole ledger is covered (several payments can settle one job).
 * STATUS only moves to Paid once the work is completed; otherwise a prepaid job skips the crew's close-out
 * card and photos. completeJob calls this again to flip prepaid jobs.
 */
export async function settleJobIfPaid(quoteId: string): Promise<void> {
  if (!UUID_RE.test(quoteId)) return;
  const res = await pgAdmin(`quote_requests?id=eq.${quoteId}&select=quote_amount,status,paid_at&limit=1`);
  if (!res.ok) return;
  const quote = ((await res.json()) as {
    quote_amount?: number | null;
    status?: string;
    paid_at?: string | null;
  }[])[0];
  if (!quote) return;

  const totalCents = toCents(quote.quote_amount);
  if (totalCents <= 0) return;

  const rows = await listPaymentsAdmin(quoteId);
  const paid = rows
    .filter((r) => r.status === "paid" || r.status === "refunded")
    .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);
  if (paid < totalCents) return;

  const patch: Record<string, unknown> = {};
  if (!quote.paid_at) patch.paid_at = new Date().toISOString();
  if (quote.status === "completed") patch.status = "paid";
  if (Object.keys(patch).length === 0) return;

  await pgAdmin(`quote_requests?id=eq.${quoteId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  // Logged once, when the money finished arriving, not when the status catches up.
  if (patch.paid_at) await addAdminEvent(quoteId, "job_paid", { amount_cents: paid });
}

// Correcting a hand-recorded figure that doesn't match what happened (e.g. a deposit recorded as the whole
// job). Not a refund: no money moved back.
// Owner only (enforced by the caller). Service role because UPDATE is revoked from authenticated so a
// contractor can't restate their own entry (least-privilege.sql).
// Card rows are excluded: they are Stripe's record and editing our copy would make the two disagree.

export function correctableReason(row: QuotePayment): string | null {
  if (row.method === "card") {
    return "Card payments come from Stripe and can't be edited here. Refund it instead if the money needs to go back.";
  }
  if (row.status === "voided") return "That payment is already voided.";
  if (row.status !== "paid") {
    return "Only a recorded payment can be corrected. This one never completed.";
  }
  if (row.refunded_cents > 0) {
    return "Part of this payment has already been refunded, so the record has to stand. Call the office.";
  }
  return null;
}

/**
 * `collectedElsewhereCents` is what the job took on its OTHER rows; the ceiling is the job total, and this
 * row must be left out of that sum.
 */
export async function correctRecordedPaymentAdmin(
  row: QuotePayment,
  patch: { amountCents: number; method: string; note: string | null },
): Promise<{ ok: boolean; error?: string; payment?: QuotePayment }> {
  // DB constraint: fee_cents < amount_cents. Checked here so it isn't a vague "could not save".
  if (patch.amountCents <= row.fee_cents) {
    return { ok: false, error: "That's less than the office's cut already taken out of this payment." };
  }

  const res = await pgAdmin(`quote_payments?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      amount_cents: patch.amountCents,
      method: patch.method,
      note: patch.note,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[payments] correction failed", row.id, detail);
    return { ok: false, error: "Could not save that correction. Please try again." };
  }
  const rows = (await res.json()) as QuotePayment[];
  return { ok: true, payment: rows[0] };
}

/** The row stays, reason in the note, so the office can still account for the money when reconciling. */
export async function voidRecordedPaymentAdmin(
  row: QuotePayment,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  // Column cap is 500; trim the front of the ORIGINAL note so the reason is never cut.
  const tail = `Voided: ${reason}`;
  const head = (row.note ?? "").trim();
  const note = head ? `${head.slice(0, Math.max(0, 500 - tail.length - 3))} - ${tail}`.slice(0, 500) : tail.slice(0, 500);

  const res = await pgAdmin(`quote_payments?id=eq.${row.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "voided", note }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[payments] void failed", row.id, detail);
    return { ok: false, error: "Could not void that payment. Please try again." };
  }
  return { ok: true };
}

/**
 * Bring paid state in line with what was collected, in both directions (a correction can DECREASE it, and
 * a stale paid_at hides the job from "customers still owe"). One function so both directions agree on the
 * line. Status only falls back to where the work is: a completed job stays completed.
 */
export async function resyncJobPaidState(quoteId: string): Promise<void> {
  if (!UUID_RE.test(quoteId)) return;
  const res = await pgAdmin(
    `quote_requests?id=eq.${quoteId}&select=quote_amount,status,paid_at,completed_at,scheduled_date&limit=1`,
  );
  if (!res.ok) return;
  const quote = ((await res.json()) as {
    quote_amount?: number | null;
    status?: string;
    paid_at?: string | null;
    completed_at?: string | null;
    scheduled_date?: string | null;
  }[])[0];
  if (!quote) return;

  const totalCents = toCents(quote.quote_amount);
  const rows = await listPaymentsAdmin(quoteId);
  const paid = rows
    .filter((r) => r.status === "paid" || r.status === "refunded")
    .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);
  const settled = totalCents > 0 && paid >= totalCents;

  const patch: Record<string, unknown> = {};
  if (settled && !quote.paid_at) patch.paid_at = new Date().toISOString();
  if (settled && quote.status === "completed") patch.status = "paid";
  if (!settled && quote.paid_at) patch.paid_at = null;
  if (!settled && quote.status === "paid") {
    // Back to the stage the WORK is at.
    patch.status = quote.completed_at ? "completed" : quote.scheduled_date ? "scheduled" : "approved";
  }
  if (Object.keys(patch).length === 0) return;

  await pgAdmin(`quote_requests?id=eq.${quoteId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}
