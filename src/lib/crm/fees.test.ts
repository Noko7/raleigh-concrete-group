// The arithmetic that decides what people get paid.
//
// fees.ts is the one file in this repo that is worth testing above all others:
// it is pure, it touches no network and no database, and it is read by three
// screens and every payment path. A mistake in here does not throw - it quietly
// bills the wrong number, and the first anybody knows of it is a contractor
// disputing a figure on the cash board.
//
// No test framework. Node's own runner (node --test) and node:assert, so this
// costs the repo nothing - which matters in a project that has deliberately
// avoided dependencies everywhere else.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applicationFeeFor,
  depositCents,
  feeRateFor,
  feeTotalCents,
  fromCents,
  isRecordedMethod,
  readLedger,
  toCents,
  usd,
  INTRO_FEE_RATE,
  STANDARD_FEE_RATE,
  type LedgerRow,
} from "./fees.ts";

// A row in the shape readLedger reads. Defaults are the common case - a paid
// card payment that carried no fee - so each test only states what it is about.
function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return { amount_cents: 0, fee_cents: 0, refunded_cents: 0, status: "paid", method: "card", ...over };
}

// ── The rate ────────────────────────────────────────────────────────────────

test("the intro rate covers the first three paid jobs, and the fourth is standard", () => {
  assert.equal(feeRateFor(0), INTRO_FEE_RATE);
  assert.equal(feeRateFor(2), INTRO_FEE_RATE);
  // Their fourth job: three came before it.
  assert.equal(feeRateFor(3), STANDARD_FEE_RATE);
  assert.equal(feeRateFor(50), STANDARD_FEE_RATE);
});

// ── Money in and out of cents ───────────────────────────────────────────────

test("dollars convert to whole cents, from a number or a numeric string", () => {
  assert.equal(toCents("4000.50"), 400050);
  assert.equal(toCents(4000.5), 400050);
  assert.equal(toCents(0.29), 29, "0.29 * 100 is 28.999999999999996 in binary float");
  assert.equal(toCents(9999999.99), 999999999);
  assert.equal(toCents(0), 0);
  assert.equal(fromCents(400050), 4000.5);
});

test("anything that isn't a number is worth nothing, not NaN", () => {
  // quote_amount is nullable, and a null total has to read as a $0 job rather
  // than poisoning every sum downstream.
  assert.equal(toCents(null), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents("not a number"), 0);
  assert.equal(toCents(""), 0);
});

test("a half-cent input rounds down, which is a known edge and not a bug", () => {
  // Math.round(1.005 * 100) is 100, not 101, because 1.005 * 100 is
  // 100.49999999999999 in binary floating point.
  //
  // Documented rather than fixed, deliberately. quote_amount is numeric(10,2),
  // so a value with a third decimal place cannot come out of the database - the
  // only way to reach this is somebody typing "1.005" into the manual payment
  // box, and the error is half a cent, once. Chasing it would mean carrying a
  // decimal library for a rounding nobody can observe.
  assert.equal(toCents(1.005), 100);
});

test("the minus sign goes in front of the dollar sign, not inside the amount", () => {
  // On a ledger being checked against a bank statement, "$-352.50" reads as a
  // typo rather than as money going the other way.
  assert.equal(usd(-35250), "-$352.50");
  assert.equal(usd(35250), "$352.50");
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(100000000), "$1,000,000.00");
});

// ── What the office earns ───────────────────────────────────────────────────

test("the fee is a percentage of the job total, rounded once", () => {
  assert.equal(feeTotalCents(1000000, 0.15), 150000);
  assert.equal(feeTotalCents(1000000, 0.1), 100000);
  // Rounded here and only here, so no combination of payments can drift off it.
  assert.equal(feeTotalCents(333333, 0.15), 50000);
});

// ── What one card payment may carry ─────────────────────────────────────────

test("an application fee is always strictly less than the payment carrying it", () => {
  // Stripe rejects a fee equal to the charge, so the whole-fee-on-a-small-
  // payment case has to come back capped rather than failing at checkout.
  assert.equal(applicationFeeFor(50000, 150000), 49999);
  assert.equal(applicationFeeFor(50000, 50000), 49999);
  // Comfortably affordable: the fee comes out whole.
  assert.equal(applicationFeeFor(500000, 150000), 150000);
});

test("nothing owed, or nothing to take it from, carries nothing", () => {
  assert.equal(applicationFeeFor(500000, 0), 0);
  assert.equal(applicationFeeFor(500000, -100), 0);
  assert.equal(applicationFeeFor(1, 150000), 0);
  assert.equal(applicationFeeFor(0, 150000), 0);
});

// ── Reading a job's ledger ──────────────────────────────────────────────────

test("an empty job owes its whole total and is not settled", () => {
  const l = readLedger(1000000, null, []);
  assert.equal(l.paidCents, 0);
  assert.equal(l.dueCents, 1000000);
  assert.equal(l.settled, false);
  // No rate frozen yet, so the office has earned nothing. A number here would
  // be a forecast, and this file is for facts.
  assert.equal(l.feeTotalCents, 0);
});

test("a $10,000 job with a $500 cash deposit owes $500 of fee today, not $1,500", () => {
  // The README's own worked example. What a contractor owes is bounded by what
  // the customer has actually handed them.
  const l = readLedger(1000000, null, [row({ amount_cents: 50000, method: "cash" })], 0.15);
  assert.equal(l.feeTotalCents, 150000);
  assert.equal(l.feeCollectedCents, 0);
  assert.equal(l.feeOwedCents, 150000);
  assert.equal(l.feeDueNowCents, 50000);
  assert.equal(l.offStripeCents, 50000);
  assert.equal(l.dueCents, 950000);
});

test("a card deposit takes the whole fee, leaving the final payment clean", () => {
  const l = readLedger(1000000, null, [row({ amount_cents: 500000, fee_cents: 150000 })], 0.15);
  assert.equal(l.feeCollectedCents, 150000);
  assert.equal(l.feeOwedCents, 0);
  assert.equal(l.feeDueNowCents, 0);
  assert.equal(l.offStripeCents, 0);
});

test("the fee follows the job's CURRENT total, not the figure stamped when it froze", () => {
  // An owner edits a priced job upward. The rate is the promise; the total is a
  // fact. Without this the next payment charges a percentage of the new total
  // while every screen reports a percentage of the old one, and the difference
  // becomes a contractor balance nobody can account for.
  const stampedWhenJobWas5k = 75000;
  const l = readLedger(1000000, stampedWhenJobWas5k, [], 0.15);
  assert.equal(l.feeTotalCents, 150000);

  // With no rate to re-derive from, the stored figure is all there is.
  assert.equal(readLedger(1000000, stampedWhenJobWas5k, []).feeTotalCents, 75000);
});

test("a checkout in flight reserves the fee it is already carrying", () => {
  // Opening the payment page on a phone and again on a laptop must not pay the
  // office's cut twice: the second checkout carries whatever the first left.
  const l = readLedger(1000000, null, [row({ amount_cents: 500000, fee_cents: 150000, status: "pending" })], 0.15);
  assert.equal(l.pendingCents, 500000);
  assert.equal(l.paidCents, 0, "a pending checkout is not money");
  assert.equal(l.feeOwedCents, 150000);
  assert.equal(l.feeReservedCents, 150000);
  assert.equal(l.feeChargeableCents, 0, "a new payment may carry nothing more");
});

test("refunds come off what was collected, and a refunded row still counts as one", () => {
  const l = readLedger(1000000, null, [
    row({ amount_cents: 500000, fee_cents: 150000 }),
    row({ amount_cents: 200000, refunded_cents: 200000, status: "refunded" }),
  ], 0.15);
  assert.equal(l.paidCents, 500000, "the fully refunded payment nets to zero");
  assert.equal(l.dueCents, 500000);
});

test("an overpaid job reads as zero due rather than a negative balance", () => {
  const l = readLedger(1000000, null, [row({ amount_cents: 1200000 })], 0.15);
  assert.equal(l.dueCents, 0);
  assert.equal(l.settled, true);
  // And the fee owed is still the fee, not a share of the overpayment.
  assert.equal(l.feeDueNowCents, 150000);
});

test("a job with no price is never settled, however much has been paid", () => {
  // Guards the "$0.00 everywhere" state: a job nobody has priced has not been
  // paid off, it has not been priced.
  const l = readLedger(0, null, [row({ amount_cents: 50000 })], 0.15);
  assert.equal(l.settled, false);
});

test("cash and card on one job split correctly between Stripe and not", () => {
  const l = readLedger(1000000, null, [
    row({ amount_cents: 400000, method: "cash" }),
    row({ amount_cents: 600000, fee_cents: 150000 }),
  ], 0.15);
  assert.equal(l.paidCents, 1000000);
  assert.equal(l.settled, true);
  assert.equal(l.offStripeCents, 400000, "only the cash");
  assert.equal(l.feeCollectedCents, 150000);
  assert.equal(l.feeDueNowCents, 0, "the card payment cleared the whole fee");
});

// ── The first payment we suggest ────────────────────────────────────────────

test("the deposit is half the job, to the cent", () => {
  assert.equal(depositCents(1000000), 500000);
  assert.equal(depositCents(333333), 166667);
  assert.equal(depositCents(1000000, 25), 250000);
});

// ── What the crew may record by hand ────────────────────────────────────────

test("card is never a method somebody can type in", () => {
  // A card payment is Stripe's word. Everything else is the crew telling us
  // what landed in their hand.
  assert.equal(isRecordedMethod("card"), false);
  assert.equal(isRecordedMethod("cash"), true);
  assert.equal(isRecordedMethod("zelle"), true);
  assert.equal(isRecordedMethod("venmo"), true);
  assert.equal(isRecordedMethod("check"), true);
  assert.equal(isRecordedMethod("other"), true);
  assert.equal(isRecordedMethod("bitcoin"), false);
  assert.equal(isRecordedMethod(""), false);
});
