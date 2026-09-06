// Server-only data access for the payment ledger. Sits beside queries.ts and
// follows its conventions: pgUser where a session exists so RLS scopes the
// read, pgAdmin only where there genuinely is no session (the customer's own
// payment page and the Stripe webhook).
import { SITE_ORIGIN } from "./env";
import {
  applicationFeeFor,
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

// ── Reading a job's ledger ──────────────────────────────────────────────────

export async function listPayments(session: Session, quoteId: string): Promise<QuotePayment[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const res = await pgUser(
    `quote_payments?quote_id=eq.${quoteId}&select=*&order=created_at.asc`,
    session.accessToken,
  );
  // The table arrives with supabase/payments.sql. Until it is run PostgREST
  // 404s the relation, and every screen reads that as "no payments yet" rather
  // than falling over - the same way a missing quote_options table is handled.
  if (!res.ok) return [];
  return (await res.json()) as QuotePayment[];
}

/** Service-role read, for the customer's own payment page and the webhook. */
export async function listPaymentsAdmin(quoteId: string): Promise<QuotePayment[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const res = await pgAdmin(`quote_payments?quote_id=eq.${quoteId}&select=*&order=created_at.asc`);
  if (!res.ok) return [];
  return (await res.json()) as QuotePayment[];
}

/** The whole money picture for one job, from its rows. */
export function ledgerOf(quote: Quote, rows: QuotePayment[]): Ledger {
  return readLedger(toCents(quote.quote_amount), quote.fee_total_cents, rows);
}

// ── Freezing the rate ───────────────────────────────────────────────────────

/**
 * How many of this contractor's jobs have already been paid.
 *
 * Counts jobs with at least one paid row, not payments - a job settled in three
 * instalments is one job. Excludes the job being priced, so a contractor's
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
 * Settle what the office earns on this job, once, and write it onto the job.
 *
 * Called the first time money is about to move. If the job already carries a
 * rate it is returned untouched - re-running this must never reprice a job
 * that has already taken a payment, which is the difference between a stable
 * agreement and a number that drifts under the contractor.
 *
 * The job total can still change afterwards (an owner edits the quote). That
 * is handled where it belongs, on the next payment: the fee owed is recomputed
 * against the frozen RATE and the current total, so a job that grows tops the
 * office up rather than under-charging.
 */
export async function ensureFeeOnJob(quote: Quote): Promise<{ rate: number; feeTotalCents: number }> {
  const totalCents = toCents(quote.quote_amount);

  if (quote.fee_rate != null && quote.fee_total_cents != null) {
    const rate = Number(quote.fee_rate);
    // Re-derived against today's total rather than trusting the stored figure:
    // the rate is the promise, the total is a fact, and the office should be
    // paid its percentage of the job as it now stands.
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

// ── Writing payments ────────────────────────────────────────────────────────

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
    // Stamped now for anything already settled. A pending card row gets its
    // timestamp from the webhook, when the money actually arrived, not from
    // when we asked for it.
    paid_at: status === "paid" ? new Date().toISOString() : null,
  };
}

/**
 * Record a payment as the signed-in user. RLS keeps a contractor to their own
 * jobs, which is what lets the crew log cash from their own job page.
 */
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
    if (detail.includes("quote_payments") && res.status === 404) {
      return { ok: false, error: "Payments aren't set up yet. Run supabase/payments.sql." };
    }
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
 * Mark a pending card payment paid, keyed by its Checkout Session.
 *
 * The webhook's landing point, and deliberately conditional on the row still
 * being pending: Stripe delivers the same event more than once by design, and
 * a second delivery must find nothing left to do rather than adding a second
 * payment to the job. Returns whether this call was the one that changed it.
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
 * Write back how much of a payment has gone home to the customer.
 *
 * A running TOTAL, never an increment - the same shape Stripe reports it in.
 * Two things write this (the refund action and the charge.refunded webhook) and
 * they routinely both fire for one refund, so the second must be able to say
 * the same thing again without doubling it.
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

// ── The contractor's Stripe account ─────────────────────────────────────────

/** Cache what Stripe says about an account onto the staff row. */
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

/** Who a Stripe account belongs to - the webhook's way back from acct_ to staff. */
export async function staffByStripeAccount(accountId: string): Promise<Staff | null> {
  const res = await pgAdmin(`staff?stripe_account_id=eq.${encodeURIComponent(accountId)}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as Staff[])[0] ?? null;
}

/** Service-role read of one contractor's payment setup, for token-gated pages. */
export async function payeeFor(staffId: string | null | undefined): Promise<Staff | null> {
  if (!staffId || !UUID_RE.test(staffId)) return null;
  const res = await pgAdmin(`staff?id=eq.${staffId}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as Staff[])[0] ?? null;
}

// ── Fee settlements (owner only) ────────────────────────────────────────────

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

// ── The whole money picture for one job ─────────────────────────────────────

// A Checkout Session Stripe will not honour any more. Their sessions expire
// after 24 hours; a little past that, a pending row of ours can never become a
// payment, and leaving it pending would hold part of the fee reserved against a
// checkout nobody is ever going to finish.
const PENDING_EXPIRY_HOURS = 26;

/** Retire pending rows whose Stripe session has expired. Safe to call often. */
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

/**
 * What the office would earn on this job, WITHOUT writing anything.
 *
 * The rate is only frozen when money actually moves. This is the read-only
 * counterpart, so a screen can show the figure on a job nobody has paid yet
 * without quietly committing the contractor to today's rate.
 */
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

/**
 * Everything any screen needs to talk about this job's money.
 *
 * `freeze` is the difference between looking and charging: pass it only where a
 * payment is actually about to happen, so merely opening the payment page does
 * not lock a contractor onto a rate.
 */
export async function jobLedger(
  quote: Quote,
  opts: { freeze?: boolean } = {},
): Promise<{ ledger: Ledger; rows: QuotePayment[]; rate: number }> {
  await expireStalePending(quote.id);
  const fee = opts.freeze ? await ensureFeeOnJob(quote) : await previewFee(quote);
  const rows = await listPaymentsAdmin(quote.id);
  return {
    ledger: readLedger(toCents(quote.quote_amount), fee.feeTotalCents, rows),
    rows,
    rate: fee.rate,
  };
}

// ── Can this job take a card at all? ────────────────────────────────────────

export type PayeeState =
  | { ok: true; staff: Staff; account: string }
  | { ok: false; reason: "unassigned" | "not_linked" | "not_ready" | "no_stripe" };

/**
 * Whether a card payment is possible on this job right now, and if not, which
 * of the four reasons it is.
 *
 * Four distinct answers rather than a boolean, because each one has a different
 * person who has to do something about it: assign the job, link an account,
 * finish Stripe's onboarding, or set STRIPE_PRIV_KEY.
 */
export async function payeeState(quote: Quote): Promise<PayeeState> {
  if (!STRIPE_READY) return { ok: false, reason: "no_stripe" };
  if (!quote.assigned_to) return { ok: false, reason: "unassigned" };
  const staff = await payeeFor(quote.assigned_to);
  if (!staff?.stripe_account_id) return { ok: false, reason: "not_linked" };
  if (!staff.stripe_charges_enabled) return { ok: false, reason: "not_ready" };
  return { ok: true, staff, account: staff.stripe_account_id };
}

// ── Taking a card payment ───────────────────────────────────────────────────

/** Below this, the card fee eats most of what is collected. */
export const MIN_PAYMENT_CENTS = 100;

/**
 * Open a hosted checkout for one payment on this job, and record our side of it.
 *
 * Order matters. The session is created first because we cannot write a row
 * keyed by a session id we don't have yet - and if the row then fails to write,
 * the session is expired again rather than left payable. A customer paying a
 * session with no row behind it is money that lands with no job attached to it,
 * which is the one failure the webhook can only log and not repair.
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

  // Frozen here, because this is the moment money moves.
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

  // Only what is left after any checkout already in flight - see readLedger.
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
    // A fresh key per attempt. Idempotency here protects a double-tapped
    // button, not two deliberate payments - so it must not be derived from the
    // job, or a customer paying in two instalments would be handed the first
    // session again the second time.
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
 * Ask Stripe directly whether a session was paid, and settle up if it was.
 *
 * The webhook is the primary path; this is the customer standing on the "thank
 * you" page a second after paying. It exists because those two race, and
 * because a misconfigured endpoint would otherwise leave every payment reading
 * as unpaid with nothing on screen to suggest why.
 *
 * Idempotent through the same conditional update the webhook uses, so whichever
 * arrives second finds nothing left to do.
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
 * Stamp a job paid once the customer has handed over everything.
 *
 * Reads the whole ledger rather than trusting one payment: a job can be settled
 * by a card payment that finishes what two cash payments started, and only the
 * sum knows that.
 *
 * Money paid and work finished are two different facts, and this only ever
 * asserts the first. A customer who pays the whole job up front would otherwise
 * jump the pipeline straight to Paid, taking the crew's close-out card off
 * their own job page and skipping the before/after photos - so the STATUS only
 * moves once the work is already marked completed. Called again from
 * completeJob, which is what flips a prepaid job over at the right moment.
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
  // Logged once, when the money finished arriving - not again when the status
  // catches up weeks later.
  if (patch.paid_at) await addAdminEvent(quoteId, "job_paid", { amount_cents: paid });
}
