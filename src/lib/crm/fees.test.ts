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
  applySettlements,
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
  depositDueNowCents,
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

// ── Change orders: the deposit has to keep counting ─────────────────────────
// A change order moves the price of a job that is already agreed, and the only
// thing it writes is quote_amount - no payment is touched, no fee is restated.
// That works solely because of what readLedger means, so these tests are here to
// hold that meaning still. If one of them ever fails, a customer who has paid a
// deposit is being asked for the wrong money.

test("a change order that raises the total leaves the deposit where it is", () => {
  // The real case this was built for: $8,250 job, half paid by card, then the
  // customer widens the patio a week before the pour and it becomes $9,400.
  const agreed = toCents(8250);
  const rate = INTRO_FEE_RATE;
  const deposit = depositCents(agreed); // 412500
  // A card deposit carries as much of the office's cut as it can.
  const paid = row({ amount_cents: deposit, fee_cents: feeTotalCents(agreed, rate) });

  const before = readLedger(agreed, feeTotalCents(agreed, rate), [paid], rate);
  assert.equal(before.paidCents, 412500);
  assert.equal(before.dueCents, 412500);

  // The ONE thing approving a change writes.
  const after = readLedger(toCents(9400), feeTotalCents(agreed, rate), [paid], rate);
  assert.equal(after.totalCents, 940000);
  assert.equal(after.paidCents, 412500, "the deposit is untouched by a change order");
  assert.equal(after.dueCents, 527500, "the balance grew by exactly the difference");
  assert.equal(after.settled, false);
});

test("the office's cut on a changed job follows the frozen rate, not the old total", () => {
  // The rate is the promise and the total is a fact, so a job that grows tops
  // the office up rather than under-charging. The stored fee_total_cents is the
  // stale figure from before the change and must be ignored while a rate exists.
  const rate = INTRO_FEE_RATE;
  const staleFee = feeTotalCents(toCents(8250), rate); // 123750
  const paid = row({ amount_cents: 412500, fee_cents: staleFee });

  const l = readLedger(toCents(9400), staleFee, [paid], rate);
  assert.equal(l.feeTotalCents, 141000, "15% of the job as it now stands");
  assert.equal(l.feeOwedCents, 17250, "the extra cut the bigger job earns");
  // Still bounded by what the customer has actually handed over.
  assert.ok(l.feeDueNowCents <= l.paidCents);
});

test("a change order that drops below the deposit reads as money owed back", () => {
  // Scope cut to less than they have already paid. The balance clamps at zero -
  // a negative "due" would show up as a credit the crew could try to collect -
  // and the overpayment is visible as paid above total, which is what both the
  // crew's card and the customer's panel show as a refund.
  const paid = row({ amount_cents: 412500 });
  const l = readLedger(toCents(4000), null, [paid], INTRO_FEE_RATE);

  assert.equal(l.dueCents, 0, "never negative");
  assert.equal(l.paidCents, 412500);
  assert.equal(l.paidCents - l.totalCents, 12500, "$125 back to the customer");
  // Nothing left to collect, so the job is settled and settleJobIfPaid will
  // stamp it - which is why the customer's answer calls that too.
  assert.equal(l.settled, true);
});

// ── Correcting what the crew recorded ───────────────────────────────────────
// A contractor took a 50% deposit and recorded the whole job as paid. The owner
// corrects the row. Nothing about the fee engine changes for that - it is one
// amount_cents being rewritten - so these tests are here to prove the three
// things that follow from it, because all three are what the Money page reports.

test("correcting a deposit recorded as the whole job restores the real balance", () => {
  const total = toCents(8250);
  const rate = INTRO_FEE_RATE;

  // What the contractor keyed in: the entire job, as cash, carrying no fee.
  const wrong = readLedger(total, null, [row({ amount_cents: total, method: "cash" })], rate);
  assert.equal(wrong.dueCents, 0, "reads as nothing left to collect");
  assert.equal(wrong.settled, true, "which is why the job got stamped paid");
  // And the office thinks the whole cut is already due from the contractor.
  assert.equal(wrong.feeDueNowCents, feeTotalCents(total, rate));

  // The owner corrects the amount to the deposit that actually arrived.
  const fixed = readLedger(total, null, [row({ amount_cents: 412500, method: "cash" })], rate);
  assert.equal(fixed.paidCents, 412500);
  assert.equal(fixed.dueCents, 412500, "the other half is owed again");
  assert.equal(fixed.settled, false, "so the job must stop claiming to be paid");

  // What the contractor owes the office does NOT move, and that is correct
  // rather than a miss. feeDueNowCents is capped by cash COLLECTED, not scaled
  // by it - the office is owed its whole cut as soon as enough has come in to
  // cover it, and $4,125 covers $1,237.50 just as well as $8,250 did. The
  // correction changes what the CUSTOMER owes; the crew's debt was already
  // fully earned by the deposit.
  assert.equal(fixed.feeDueNowCents, feeTotalCents(total, rate));
  assert.equal(fixed.feeDueNowCents, wrong.feeDueNowCents);

  // Where the correction does reach the fee is on a job whose deposit is
  // smaller than the cut itself.
  const small = readLedger(total, null, [row({ amount_cents: 50000, method: "cash" })], rate);
  assert.equal(small.feeDueNowCents, 50000, "never more than the crew have actually been handed");
});

test("a voided payment counts for nothing, everywhere", () => {
  // Voided is not refunded. No money moved, so there is no outgoing to record -
  // the honest ledger is simply the one without the row in it. Every total in
  // the business sums 'paid' and 'refunded' only, so this one line is what makes
  // that true for the fee engine.
  const total = toCents(8250);
  const live = row({ amount_cents: 412500, method: "cash" });
  const dead = row({ amount_cents: 412500, method: "cash", status: "voided" });

  const l = readLedger(total, null, [live, dead], INTRO_FEE_RATE);
  assert.equal(l.paidCents, 412500, "only the live row is money");
  assert.equal(l.dueCents, 412500);
  assert.equal(l.offStripeCents, 412500, "and the cash board agrees");
  assert.equal(l.settled, false);

  // A job whose ONLY payment was voided is back to untouched.
  const none = readLedger(total, null, [dead], INTRO_FEE_RATE);
  assert.equal(none.paidCents, 0);
  assert.equal(none.dueCents, total);
  assert.equal(none.feeDueNowCents, 0, "nothing collected, so nothing owed to the office yet");
});

test("a corrected deposit and a change order compose correctly", () => {
  // Both halves of what was asked for, in the order they happen: the owner fixes
  // the 50% that was recorded as 100%, THEN the crew send a change order. This
  // is the case the review step exists to protect - sending the change first
  // would have shown the customer a $0 balance on a job they owe half of.
  const agreed = toCents(8250);
  const rate = INTRO_FEE_RATE;
  const deposit = row({ amount_cents: 412500, method: "cash" });

  // After the correction, before the change.
  const corrected = readLedger(agreed, null, [deposit], rate);
  assert.equal(corrected.dueCents, 412500);

  // The customer approves the patio going two feet wider: $9,400.
  const after = readLedger(toCents(9400), null, [deposit], rate);
  assert.equal(after.totalCents, 940000);
  assert.equal(after.paidCents, 412500, "the real deposit, still counted");
  assert.equal(after.dueCents, 527500, "$5,275 - the half they owed plus the $1,150 change");
  assert.equal(after.feeTotalCents, 141000, "15% of the job as it now stands");

  // Had the wrong figure stood, the customer would have been shown this instead.
  const uncorrected = readLedger(toCents(9400), null, [row({ amount_cents: agreed, method: "cash" })], rate);
  assert.equal(uncorrected.dueCents, 115000, "only the change itself - the deposit swallowed the rest");
  assert.notEqual(uncorrected.dueCents, after.dueCents);
});

// ── No deposit ──────────────────────────────────────────────────────────────
// Not every job takes one. These hold the two no-deposit paths still: a change
// order on a job nobody has paid anything on, and a payment that was recorded
// when no money came in at all - which is voided, never corrected to $0.

test("a change order on a job with no deposit asks for the whole new total", () => {
  // Nothing paid, so no rate has been frozen either - the office earns nothing
  // until money actually moves, and that holds through a change.
  const before = readLedger(toCents(5000), null, [], null);
  assert.equal(before.dueCents, 500000);

  const after = readLedger(toCents(5800), null, [], null);
  assert.equal(after.paidCents, 0);
  assert.equal(after.dueCents, 580000, "the full new total, nothing taken off it");
  assert.equal(after.feeTotalCents, 0, "no rate is frozen until money moves");
  assert.equal(after.feeDueNowCents, 0);
  assert.equal(after.settled, false);
});

test("a payment recorded when nothing came in is voided, leaving the job untouched", () => {
  // The crew recorded the whole $5,000 job; no money was handed over at all.
  // The fix is to void the row - a payment is never $0 - and the ledger must
  // then read exactly like a job nobody has paid on.
  const total = toCents(5000);
  const rate = INTRO_FEE_RATE; // frozen when the wrong row went in

  const wrong = readLedger(total, null, [row({ amount_cents: total, method: "cash" })], rate);
  assert.equal(wrong.settled, true);
  assert.equal(wrong.feeDueNowCents, 75000, "the crew were billed $750 on money they never took");

  const voided = readLedger(total, null, [row({ amount_cents: total, method: "cash", status: "voided" })], rate);
  assert.equal(voided.paidCents, 0);
  assert.equal(voided.dueCents, total, "the whole job is owed again");
  assert.equal(voided.settled, false);
  // The rate stays frozen (that is a promise, not a payment), but nothing is due
  // to the office yet because nothing has been collected.
  assert.equal(voided.feeTotalCents, 75000);
  assert.equal(voided.feeDueNowCents, 0, "and the crew owe the office nothing until it does");
});

// ── A fee the contractor has already sent the office ────────────────────────
// Rafa's first job: Brandon Robinson, $5,000, paid in full in cash. The office's
// 15% is $750, and Rafa Zelled it over two days later. The Money page always
// knew; the job pages didn't, and kept telling him to send it.

test("a settled cash fee reads as nothing owed on the job", () => {
  const total = toCents(5000);
  const ledger = readLedger(total, null, [row({ amount_cents: total, method: "cash" })], INTRO_FEE_RATE);
  assert.equal(ledger.feeTotalCents, 75000);
  assert.equal(ledger.feeDueNowCents, 75000, "before the Zelle: $750 owed");
  assert.equal(ledger.feeSettledCents, 0, "readLedger never counts settlements itself");

  const after = applySettlements(ledger, 75000);
  assert.equal(after.feeSettledCents, 75000);
  assert.equal(after.feeDueNowCents, 0, "nothing left to send over");
  assert.equal(after.feeOwedCents, 0);
  // What the customer owes is a different question and must not move.
  assert.equal(after.dueCents, ledger.dueCents);
  assert.equal(after.paidCents, ledger.paidCents);
  assert.equal(after.settled, true);
});

test("a card payment after a settled fee does not take the office's cut again", () => {
  // Half paid in cash, the crew Zelled the WHOLE $750 cut, then the customer
  // pays the balance by card. That card payment must carry no fee - the office
  // already has every cent of it.
  const total = toCents(5000);
  const cashHalf = row({ amount_cents: 250000, method: "cash" });
  const settled = applySettlements(readLedger(total, null, [cashHalf], INTRO_FEE_RATE), 75000);
  assert.equal(settled.feeChargeableCents, 0);
  assert.equal(applicationFeeFor(250000, settled.feeChargeableCents), 0);
});

test("a partial settlement leaves exactly the remainder owed", () => {
  const total = toCents(5000);
  const ledger = readLedger(total, null, [row({ amount_cents: total, method: "cash" })], INTRO_FEE_RATE);
  const after = applySettlements(ledger, 50000);
  assert.equal(after.feeDueNowCents, 25000);
  assert.equal(after.feeChargeableCents, 25000);
  // Over-settling never reads as the office owing the crew on the job page;
  // the Money page is where that conversation happens.
  assert.equal(applySettlements(ledger, 90000).feeDueNowCents, 0);
  assert.equal(applySettlements(ledger, 0), ledger, "no settlement, no change");
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

// ── A second deposit on a change ────────────────────────────────────────────
// Dave: $8,000 patio, $4,000 paid. A change adds $1,390 of materials and asks
// for that $1,390 up front. On approval the target is what he had paid plus the
// deposit, $5,390, and "due now" is how far short of it he is.

test("a second deposit is due until it comes in, then reads zero", () => {
  const target = 400000 + 139000;
  // Approved: total $9,390, paid $4,000, due $5,390.
  assert.equal(depositDueNowCents(target, 400000, 539000), 139000);
  // His $1,390 check is recorded.
  assert.equal(depositDueNowCents(target, 539000, 400000), 0);
  // Part of it came in.
  assert.equal(depositDueNowCents(target, 450000, 489000), 89000);
  // He paid more than asked.
  assert.equal(depositDueNowCents(target, 600000, 339000), 0);
});

test("never more than the balance, and nothing when none was asked for", () => {
  // A later change lowered the price below the target.
  assert.equal(depositDueNowCents(539000, 400000, 50000), 50000);
  assert.equal(depositDueNowCents(null, 400000, 539000), 0);
  assert.equal(depositDueNowCents(undefined, 0, 800000), 0);
});
