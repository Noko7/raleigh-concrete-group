// A change order's breakdown: what a change starts from, and when it counts as
// a change at all.
//
// A change to an agreed job is what the customer approves, and approving it
// replaces the job's line items. So the two questions worth pinning down are
// "which lines is the job made of today" (the change is prefilled from them)
// and "has the breakdown actually changed" (a same-total change is only sent
// when it has).
//
// Same setup as fees.test.ts: Node's own runner, no framework.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { boughtLines, optionsTotal, sameChangeLines } from "./constants.ts";

const opt = (
  title: string,
  amount: number | string,
  required: boolean,
  customer_response: "accepted" | "declined" | null = null,
  description: string | null = null,
) => ({ title, amount, required, customer_response, description });

test("the job is made of its required lines plus the extras they said yes to", () => {
  const lines = boughtLines([
    opt("Materials", "4200.00", true, "accepted", "4,000 psi concrete"),
    opt("Labor", 3800, true, "accepted"),
    opt("Sealer coat", 450, false, "accepted"),
    opt("Sidewalk", 1200, false, "declined"),
  ]);
  assert.deepEqual(lines, [
    { title: "Materials", description: "4,000 psi concrete", amount: 4200 },
    { title: "Labor", description: null, amount: 3800 },
    { title: "Sealer coat", description: null, amount: 450 },
  ]);
  // A declined extra is not part of the job, so it is not part of the total.
  assert.equal(optionsTotal(lines), 8450);
});

test("an unanswered extra is not part of the job", () => {
  assert.deepEqual(boughtLines([opt("Sealer coat", 450, false, null)]), []);
});

test("a one-price job has no lines to start from", () => {
  assert.deepEqual(boughtLines([]), []);
});

test("an empty description reads the same as none", () => {
  assert.equal(
    sameChangeLines(
      [{ title: "Labor", description: "", amount: 3800 }],
      [{ title: "Labor", description: null, amount: 3800 }],
    ),
    true,
  );
});

test("moving money between lines is a change, even at the same total", () => {
  const before = [
    { title: "Materials", description: null, amount: 4200 },
    { title: "Labor", description: null, amount: 3800 },
  ];
  const after = [
    { title: "Materials", description: null, amount: 4000 },
    { title: "Labor", description: null, amount: 4000 },
  ];
  assert.equal(optionsTotal(before), optionsTotal(after));
  assert.equal(sameChangeLines(before, after), false);
});

test("a renamed, reordered, added or removed line is a change", () => {
  const base = [
    { title: "Materials", description: null, amount: 4200 },
    { title: "Labor", description: null, amount: 3800 },
  ];
  assert.equal(sameChangeLines(base, [{ ...base[0], title: "Concrete" }, base[1]]), false);
  assert.equal(sameChangeLines(base, [base[1], base[0]]), false);
  assert.equal(sameChangeLines(base, [...base, { title: "Permits", description: null, amount: 0 }]), false);
  assert.equal(sameChangeLines(base, [base[0]]), false);
  // Dropping every line puts the job back to one price.
  assert.equal(sameChangeLines(base, []), false);
});

test("amounts compare as money whether they arrive as text or numbers", () => {
  assert.equal(
    sameChangeLines(
      [{ title: "Labor", description: null, amount: 3800 }],
      [{ title: "Labor", description: null, amount: "3800.00" as unknown as number }],
    ),
    true,
  );
});
