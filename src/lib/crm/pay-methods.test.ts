// The customer's "how will you pay" choice: only the contractor's methods survive, in a fixed order, so a
// tampered form can't put a method on the job the contractor doesn't take.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptedMethods, cleanCustomerChoice, isPayMethod, methodList } from "./pay-methods.ts";

test("accepted methods: the contractor's, in order; the default four when unset", () => {
  assert.deepEqual(acceptedMethods(["card", "zelle"]), ["zelle", "card"]);
  assert.deepEqual(acceptedMethods(null), ["zelle", "venmo", "check", "cash"]);
  assert.deepEqual(acceptedMethods([]), ["zelle", "venmo", "check", "cash"]);
  assert.deepEqual(acceptedMethods(["bitcoin"]), ["zelle", "venmo", "check", "cash"], "junk falls back");
});

test("customer choice: kept only if the contractor takes it; order fixed; no repeats", () => {
  const accepted = acceptedMethods(["zelle", "cash", "card"]);
  assert.deepEqual(cleanCustomerChoice(["card", "zelle", "zelle"], accepted), ["zelle", "card"]);
  assert.deepEqual(cleanCustomerChoice(["venmo"], accepted), [], "not taken by this contractor");
  assert.deepEqual(cleanCustomerChoice("cash", accepted), [], "not an array");
  assert.deepEqual(cleanCustomerChoice([{ x: 1 }, "drop table"], accepted), []);
  assert.deepEqual(cleanCustomerChoice(undefined, accepted), []);
});

test("names", () => {
  assert.equal(methodList(["zelle", "card"]), "Zelle, Card");
  assert.ok(isPayMethod("card"));
  assert.ok(!isPayMethod("Card"));
});
