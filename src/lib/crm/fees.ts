// What the office earns, and how it gets taken.
//
// Kept apart from queries.ts and from Stripe on purpose: this is the one place
// the business's arithmetic lives, it touches no network and no database, and
// it is the file to read when somebody asks why a number is what it is.
//
// Safe to import from client components - the crew's job page shows the same
// figures the server charges.

// ── The rate ────────────────────────────────────────────────────────────────
// A contractor's first three paid jobs are billed at the intro rate; everything
// after is the standard one. "Paid" means money actually moved - a lead that
// died after approval doesn't burn one of the three, and the counter and the
// rate are therefore decided by the same event.
export const INTRO_FEE_RATE = 0.15;
export const STANDARD_FEE_RATE = 0.10;
export const INTRO_JOB_COUNT = 3;

/** Half of the job up front, unless somebody types a different figure. */
export const DEFAULT_DEPOSIT_PERCENT = 50;

export const PAYMENT_METHODS = ["card", "cash", "venmo", "zelle", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Everything except `card` is money the crew received and told us about. */
export const RECORDED_METHODS = PAYMENT_METHODS.filter((m) => m !== "card");

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "Check",
  other: "Other",
};

/**
 * The rate this contractor is on, given how many jobs of theirs have already
 * been paid.
 *
 * `paidJobsBefore` counts jobs OTHER than this one. Their fourth job is the
 * first at the standard rate.
 */
export function feeRateFor(paidJobsBefore: number): number {
  return paidJobsBefore < INTRO_JOB_COUNT ? INTRO_FEE_RATE : STANDARD_FEE_RATE;
}

/** Dollars as stored on a quote (numeric) to whole cents. */
export function toCents(amount: number | string | null | undefined): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export const usd = (cents: number): string =>
  `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What the office earns on a job, in cents.
 *
 * A percentage of the job's TOTAL - not of any one payment - which is the rule
 * the whole design rests on: the fee is the same whether the customer pays by
 * card, in cash, or half of each. Rounded once, here, so no combination of
 * payments can drift a cent away from it.
 */
export function feeTotalCents(jobTotalCents: number, rate: number): number {
  return Math.round(jobTotalCents * rate);
}

/**
 * How much of the outstanding fee THIS card payment can carry.
 *
 * Take as much as possible, as early as possible. On a normal job that means
 * the whole fee comes out of the deposit and the final payment is entirely the
 * contractor's, which is what the office asked for and what leaves the crew
 * their materials money on day one.
 *
 * The cap is Stripe's: an application fee must be strictly less than the
 * payment carrying it. So a customer who pays $9,000 cash and $1,000 by card
 * leaves part of the fee uncollected rather than failing the payment - the
 * remainder stays owed and rides along to the contractor's next card job.
 */
export function applicationFeeFor(paymentCents: number, feeOwedCents: number): number {
  if (feeOwedCents <= 0 || paymentCents <= 1) return 0;
  return Math.max(0, Math.min(feeOwedCents, paymentCents - 1));
}

// ── Reading a job's ledger ──────────────────────────────────────────────────

export type LedgerRow = {
  amount_cents: number;
  fee_cents: number;
  refunded_cents: number;
  status: string;
  method: string;
};

export type Ledger = {
  /** What the job is worth. */
  totalCents: number;
  /** Collected from the customer, net of refunds. */
  paidCents: number;
  /** Still to collect from the customer. Never negative - an overpayment reads as zero due. */
  dueCents: number;
  /** On a checkout the customer has opened but not finished. */
  pendingCents: number;
  /** What the office earns on this job. */
  feeTotalCents: number;
  /** What Stripe has already moved to the office. */
  feeCollectedCents: number;
  /** Of the fee, how much is not yet collected. The ceiling on a card payment's cut. */
  feeOwedCents: number;
  /**
   * What the contractor actually owes the office TODAY.
   *
   * Bounded by what the customer has handed over: a $500 cash deposit on a
   * $10,000 job makes $500 due, not the whole $1,500. The office is never owed
   * money the contractor has not been paid yet, and the rest becomes due as the
   * balance comes in.
   */
  feeDueNowCents: number;
  /** Of the owed fee, how much is already promised to a checkout in flight. */
  feeReservedCents: number;
  /** What a NEW payment may carry. Owed, less anything already reserved. */
  feeChargeableCents: number;
  /** Nothing left to collect from the customer. */
  settled: boolean;
  /** Of what has been collected, how much never touched Stripe. */
  offStripeCents: number;
};

export function readLedger(
  jobTotalCents: number,
  feeTotal: number | null | undefined,
  rows: LedgerRow[],
): Ledger {
  const paid = rows.filter((r) => r.status === "paid" || r.status === "refunded");
  const pending = rows.filter((r) => r.status === "pending");

  const paidCents = paid.reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);
  const feeCollectedCents = paid.reduce((sum, r) => sum + r.fee_cents, 0);
  const offStripeCents = paid
    .filter((r) => r.method !== "card")
    .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);

  // The frozen figure if the job has one, otherwise what it would be at
  // today's rate - so a job that hasn't been paid yet still shows the office
  // what it stands to earn.
  const total = feeTotal ?? 0;
  const feeOwedCents = Math.max(0, total - feeCollectedCents);

  // A checkout that has been opened and not yet paid is already carrying part
  // of the fee. Subtracting it here is what stops a customer who opens the
  // payment page on their phone and again on a laptop paying the office's cut
  // twice - the second checkout carries whatever the first one left, which is
  // usually nothing.
  //
  // Under-collecting is the safe direction to fail in: an uncollected fee stays
  // owed on the job and shows up on the cash board. Over-collecting takes money
  // out of a contractor's balance that they never owed.
  const feeReservedCents = pending.reduce((sum, r) => sum + r.fee_cents, 0);

  return {
    totalCents: jobTotalCents,
    paidCents,
    dueCents: Math.max(0, jobTotalCents - paidCents),
    pendingCents: pending.reduce((sum, r) => sum + r.amount_cents, 0),
    feeTotalCents: total,
    feeCollectedCents,
    feeOwedCents,
    // A card payment takes as much of the fee as it can carry, so on a card
    // deposit this lands at zero straight away. It only stays positive when
    // money arrived some way that couldn't pay the office on the way past.
    feeDueNowCents: Math.max(0, Math.min(total, paidCents) - feeCollectedCents),
    feeReservedCents,
    feeChargeableCents: Math.max(0, feeOwedCents - feeReservedCents),
    settled: paidCents >= jobTotalCents && jobTotalCents > 0,
    offStripeCents,
  };
}

/** Half the job, rounded to the cent, for the first payment we suggest. */
export function depositCents(jobTotalCents: number, percent = DEFAULT_DEPOSIT_PERCENT): number {
  return Math.round((jobTotalCents * percent) / 100);
}
