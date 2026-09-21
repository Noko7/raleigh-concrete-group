// What a quote is worth, given what the customer said.
//
// Three shapes of quote now share one column. A single price; a list of line
// items the customer answers one at a time; and - new - a choice of ways to do
// the same job, of which they pick exactly one. Every screen, text and payment
// request reads quote_amount and trusts that these functions put the right
// number in it, so the arithmetic is worth pinning down here rather than
// discovering through a customer's invoice.
//
// Same setup as fees.test.ts: Node's own runner, no framework.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allInTotal,
  leadPackage,
  optionsTotal,
  packageLetter,
  quoteTotal,
  selectedTotal,
} from "./constants.ts";

// numeric(10,2) reaches these functions as a string from PostgREST as often as
// it does as a number, so the helpers take both and the tests use both.
const item = (id: string, amount: number | string, required = false) => ({ id, amount, required });
const pkg = (amount: number | string, recommended = false) => ({ amount, recommended });

// ── The old shapes still behave exactly as they did ─────────────────────────

test("a quote with no choice and no line items is worth nothing extra", () => {
  assert.equal(quoteTotal(null, [], {}), 0);
  assert.equal(allInTotal([], []), 0);
});

test("with line items and no choice, the total is still what selectedTotal says", () => {
  const rows = [item("a", 1000, true), item("b", 500)];
  assert.equal(quoteTotal(null, rows, { b: "accepted" }), selectedTotal(rows, { b: "accepted" }));
  assert.equal(quoteTotal(null, rows, { b: "declined" }), 1000);
  assert.equal(allInTotal([], rows), optionsTotal(rows));
});

// ── The choice ──────────────────────────────────────────────────────────────

test("the price is the option they picked plus the extras they kept", () => {
  const rows = [item("demo", 1200, true), item("path", 900)];
  assert.equal(quoteTotal(pkg(8500), rows, { path: "accepted" }), 10600);
  assert.equal(quoteTotal(pkg(8500), rows, { path: "declined" }), 9700);
  // The other way of doing the same job, same answers: only the option moves.
  assert.equal(quoteTotal(pkg(6200), rows, { path: "declined" }), 7400);
});

test("saying no to every extra still buys the option they picked", () => {
  assert.equal(quoteTotal(pkg(8500), [item("path", 900)], { path: "declined" }), 8500);
});

test("an unanswered extra counts as not taken, so a half-answered quote reads low", () => {
  assert.equal(quoteTotal(pkg(8500), [item("path", 900)], {}), 8500);
});

test("a price that arrived from PostgREST as a string is still a number", () => {
  // numeric(10,2) comes back as a string, and "8500" + 900 is not 9400.
  assert.equal(quoteTotal(pkg("8500.50"), [item("path", "900.25")], { path: "accepted" }), 9400.75);
});

// ── The headline figure a quote carries while it is out ─────────────────────

test("the lead option is the recommended one, else the first", () => {
  assert.equal(leadPackage([pkg(8500), pkg(6200, true)])?.amount, 6200);
  assert.equal(leadPackage([pkg(8500), pkg(6200)])?.amount, 8500);
  assert.equal(leadPackage([]), null);
});

test("one option is not a choice, so it leads nothing and prices nothing", () => {
  // Somebody halfway through writing the second card. The row is kept, but
  // until there is something to choose between it must not touch the price.
  assert.equal(leadPackage([pkg(8500)]), null);
  assert.equal(allInTotal([pkg(8500)], [item("demo", 1200, true)]), 1200);
});

test("the all-in figure is the lead option plus everything else on the quote", () => {
  const rows = [item("demo", 1200, true), item("path", 900)];
  // Recommended second card leads, so the headline is 6200 rather than 8500.
  assert.equal(allInTotal([pkg(8500), pkg(6200, true)], rows), 8300);
  assert.equal(allInTotal([pkg(8500), pkg(6200)], rows), 10600);
});

test("cents survive the arithmetic rather than arriving as a long float", () => {
  assert.equal(quoteTotal(pkg(0.1), [item("a", 0.2, true)], {}), 0.3);
  assert.equal(allInTotal([pkg(0.1), pkg(5)], [item("a", 0.2, true)]), 0.3);
});

// ── What the customer reads on the cards ────────────────────────────────────

test("options are lettered from A, and the letters do not run out", () => {
  assert.equal(packageLetter(0), "A");
  assert.equal(packageLetter(1), "B");
  assert.equal(packageLetter(3), "D");
  assert.equal(packageLetter(26), "A");
});
