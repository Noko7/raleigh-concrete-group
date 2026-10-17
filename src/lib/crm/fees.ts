// What the office earns, and how it gets taken. The business's arithmetic lives
// only here: no network, no database, safe for client components (the crew's
// job page shows the same figures the server charges).

// ── The rate ────────────────────────────────────────────────────────────────
// A contractor's first three PAID jobs use the intro rate, then standard.
// "Paid" means money moved, so a lead that died after approval doesn't use one.
export const INTRO_FEE_RATE = 0.15;
export const STANDARD_FEE_RATE = 0.10;
export const INTRO_JOB_COUNT = 3;

/** Half of the job up front, unless somebody types a different figure. */
export const DEFAULT_DEPOSIT_PERCENT = 50;

export const PAYMENT_METHODS = ["card", "cash", "venmo", "zelle", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Everything except `card` is money the crew received and told us about. */
export const RECORDED_METHODS = PAYMENT_METHODS.filter((m) => m !== "card");

/** A method somebody types into a form. Never `card` - that only comes from Stripe. */
export type RecordedMethod = Exclude<PaymentMethod, "card">;

/**
 * String in, RecordedMethod out. A guard because RECORDED_METHODS' element type
 * excludes "card", so `includes` on a wider string is a type error.
 */
export function isRecordedMethod(value: string): value is RecordedMethod {
  return (RECORDED_METHODS as readonly string[]).includes(value);
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  cash: "Cash",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "Check",
  other: "Other",
};

/**
 * The contractor's rate. `paidJobsBefore` excludes this job, so their fourth
 * job is the first at the standard rate.
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

/**
 * Cents to dollars with the sign before the symbol ("-$352.50", not
 * "$-352.50"), since the ledger is checked against bank statements.
 */
export const usd = (cents: number): string => {
  const value = Math.round(cents) / 100;
  const body = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-" : ""}$${body}`;
};

/**
 * The office's earnings on a job, in cents: a percentage of the TOTAL, not of
 * any payment, so it's the same however the customer pays. Rounded once here
 * so no mix of payments drifts a cent.
 */
export function feeTotalCents(jobTotalCents: number, rate: number): number {
  return Math.round(jobTotalCents * rate);
}

/**
 * How much of the outstanding fee this card payment can carry: as much as
 * possible, as early as possible, so normally the deposit carries the whole fee
 * and the crew have materials money on day one.
 *
 * Stripe requires an application fee strictly below the payment. Any remainder
 * stays owed (e.g. $9,000 cash + $1,000 card) instead of failing the payment.
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
  /** Still to collect. Never negative; an overpayment reads as zero due. */
  dueCents: number;
  /** On a checkout the customer has opened but not finished. */
  pendingCents: number;
  /** What the office earns on this job. */
  feeTotalCents: number;
  /** What Stripe has already moved to the office. */
  feeCollectedCents: number;
  /** Fee not yet collected; the ceiling on a card payment's cut. */
  feeOwedCents: number;
  /**
   * What the contractor owes the office TODAY: the whole fee less what reached
   * the office, regardless of how much the customer has paid ($10,000 at 15%
   * owes $1,500 whether $500 or all of it is in).
   */
  feeDueNowCents: number;
  /** The office's fee: its rate on the whole job total, less waivers. */
  feeEarnedCents: number;
  /** Of the owed fee, how much is already promised to a checkout in flight. */
  feeReservedCents: number;
  /** What a NEW payment may carry. Owed, less anything already reserved. */
  feeChargeableCents: number;
  /**
   * Fee the contractor has paid the office by hand against THIS job. Always 0
   * from readLedger; applySettlements adds it, so the Money page (which nets
   * settlements per contractor) never counts one twice.
   */
  feeSettledCents: number;
  /** Taken off the fee by the owner (fee_waived_cents). Already out of feeTotalCents. */
  feeWaivedCents: number;
  /** Nothing left to collect from the customer. */
  settled: boolean;
  /** Of what has been collected, how much never touched Stripe. */
  offStripeCents: number;
};

/**
 * @param feeTotal  Cents stamped on the job when its rate was frozen.
 * @param feeRate   The frozen rate. When present the fee is RE-DERIVED against
 *                  the current total, exactly as ensureFeeOnJob does before
 *                  charging; otherwise editing a priced job makes screens and
 *                  charges disagree.
 */
export function readLedger(
  jobTotalCents: number,
  feeTotal: number | null | undefined,
  rows: LedgerRow[],
  feeRate?: number | null,
  feeWaivedCents?: number | null,
): Ledger {
  const paid = rows.filter((r) => r.status === "paid" || r.status === "refunded");
  const pending = rows.filter((r) => r.status === "pending");

  const paidCents = paid.reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);
  const feeCollectedCents = paid.reduce((sum, r) => sum + r.fee_cents, 0);
  const offStripeCents = paid
    .filter((r) => r.method !== "card")
    .reduce((sum, r) => sum + r.amount_cents - r.refunded_cents, 0);

  // The rate is the promise; the total is a fact: fee = rate x current total,
  // as ensureFeeOnJob computes. Zero until a rate is frozen (when money is first
  // about to move); before that it would be a forecast. Less any owner waiver
  // (e.g. materials passed through at cost).
  const fullFee = feeRate != null ? feeTotalCents(jobTotalCents, Number(feeRate)) : (feeTotal ?? 0);
  const waived = Math.min(fullFee, Math.max(0, Math.round(Number(feeWaivedCents) || 0)));
  const total = fullFee - waived;
  const feeOwedCents = Math.max(0, total - feeCollectedCents);
  // Whole fee on the current total (after change orders), not a share of what's paid.
  const feeEarnedCents = total;

  // An open, unpaid checkout already carries part of the fee; subtracting it
  // stops two checkouts (phone and laptop) taking the cut twice. Under-collecting
  // is the safe failure: the remainder stays owed on the cash board.
  const feeReservedCents = pending.reduce((sum, r) => sum + r.fee_cents, 0);

  return {
    totalCents: jobTotalCents,
    paidCents,
    dueCents: Math.max(0, jobTotalCents - paidCents),
    pendingCents: pending.reduce((sum, r) => sum + r.amount_cents, 0),
    feeTotalCents: total,
    feeCollectedCents,
    feeOwedCents,
    // Card payments carry the fee, so this is zero after a card deposit and only
    // positive when money arrived off Stripe.
    feeDueNowCents: Math.max(0, feeEarnedCents - feeCollectedCents),
    feeEarnedCents,
    feeReservedCents,
    feeChargeableCents: Math.max(0, feeOwedCents - feeReservedCents),
    feeSettledCents: 0,
    feeWaivedCents: waived,
    settled: paidCents >= jobTotalCents && jobTotalCents > 0,
    offStripeCents,
  };
}

/**
 * Net a job's ledger of fee the contractor already paid the office by hand
 * (a settlement, e.g. by Zelle on a cash job), so job pages stop saying "send
 * this over". Only settlements recorded against this job, and only for job
 * screens and checkout (jobLedger); the Money page nets per contractor itself.
 * Must reach feeChargeableCents, or a later card payment takes the cut again.
 */
export function applySettlements(ledger: Ledger, settledCents: number): Ledger {
  const settled = Math.max(0, Math.round(settledCents));
  if (settled === 0) return ledger;
  const feeOwedCents = Math.max(0, ledger.feeOwedCents - settled);
  return {
    ...ledger,
    feeSettledCents: settled,
    feeOwedCents,
    feeDueNowCents: Math.max(0, ledger.feeDueNowCents - settled),
    feeChargeableCents: Math.max(0, feeOwedCents - ledger.feeReservedCents),
  };
}

/**
 * Second deposit still unpaid, in cents. A change can set a target for total
 * paid before work starts; this is the shortfall, clamped to [0, balance].
 */
export function depositDueNowCents(targetCents: number | null | undefined, paidCents: number, dueCents: number): number {
  if (targetCents == null) return 0;
  return Math.max(0, Math.min(Number(targetCents) - paidCents, dueCents));
}

/** Suggested first payment: `percent` of the job (default half), in cents. */
export function depositCents(jobTotalCents: number, percent = DEFAULT_DEPOSIT_PERCENT): number {
  return Math.round((jobTotalCents * percent) / 100);
}

/**
 * What the contractor keeps after the office's cut. On a job that left the
 * pipeline after taking money, only what was collected counts.
 */
export function crewIncomeCents(ledger: Ledger, onBooks: boolean): number {
  const base = onBooks ? ledger.totalCents : ledger.paidCents;
  return Math.max(0, base - ledger.feeTotalCents);
}
