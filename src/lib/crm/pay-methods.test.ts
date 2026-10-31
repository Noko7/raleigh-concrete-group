// The customer's "how will you pay" choice: only the contractor's methods survive, in a fixed order, so a
// tampered form can't put a method on the job the contractor doesn't take.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptedMethods, isPayMethod, methodList, methodsFromSignedValues, payFieldName } from "./pay-methods.ts";

test("accepted methods: the contractor's, in order; the default four when unset", () => {
  assert.deepEqual(acceptedMethods(["card", "zelle"]), ["zelle", "card"]);
  assert.deepEqual(acceptedMethods(null), ["zelle", "venmo", "check", "cash"]);
  assert.deepEqual(acceptedMethods([]), ["zelle", "venmo", "check", "cash"]);
  assert.deepEqual(acceptedMethods(["bitcoin"]), ["zelle", "venmo", "check", "cash"], "junk falls back");
});

test("signed values: the ticked Pays-by boxes, in order; anything else ignored", () => {
  assert.deepEqual(
    methodsFromSignedValues([
      { field: "Pays by Card", value: true },
      { field: "Pays by Zelle", value: "Yes" },
      { field: "Pays by Venmo", value: false },
      { field: "Pays by Bitcoin", value: true },
      { field: "Initials 1", value: "AB" },
    ]),
    ["zelle", "card"],
  );
  assert.deepEqual(methodsFromSignedValues(null), []);
  assert.deepEqual(methodsFromSignedValues("x"), []);
  assert.equal(payFieldName("check"), "Pays by Check");
});

test("names", () => {
  assert.equal(methodList(["zelle", "card"]), "Zelle, Card");
  assert.ok(isPayMethod("card"));
  assert.ok(!isPayMethod("Card"));
});
