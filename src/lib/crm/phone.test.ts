import assert from "node:assert/strict";
import { test } from "node:test";

import { ccCopyTo, parseCcPhone, toE164 } from "./phone.ts";

test("toE164 keeps its old behaviour", () => {
  assert.equal(toE164("(919) 555-0142"), "+19195550142");
  assert.equal(toE164("1-919-555-0142"), "+19195550142");
  assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(toE164("555-0142"), null);
  assert.equal(toE164(""), null);
});

const base = { role: "customer", kind: "quote_ready", quoteId: "q1", customerTo: "9195550142", cc: "919-555-0188" };

test("a customer text on a job with a second number is copied there, in E.164", () => {
  assert.equal(ccCopyTo(base), "+19195550188");
});

test("no second number, no copy", () => {
  assert.equal(ccCopyTo({ ...base, cc: null }), null);
  assert.equal(ccCopyTo({ ...base, cc: undefined }), null);
  assert.equal(ccCopyTo({ ...base, cc: "  " }), null);
  assert.equal(ccCopyTo({ ...base, cc: "garbage" }), null);
});

test("only customer texts on a job are copied", () => {
  assert.equal(ccCopyTo({ ...base, role: "owner" }), null);
  assert.equal(ccCopyTo({ ...base, role: "crew" }), null);
  assert.equal(ccCopyTo({ ...base, role: undefined }), null);
  assert.equal(ccCopyTo({ ...base, quoteId: null }), null);
});

test("a Retry of one row is not copied again", () => {
  assert.equal(ccCopyTo({ ...base, noCc: true }), null);
});

test("the agreement signing link goes to the customer alone", () => {
  assert.equal(ccCopyTo({ ...base, kind: "agreement_sign_customer" }), null);
});

test("a second number that is the customer's own number gets nothing extra", () => {
  assert.equal(ccCopyTo({ ...base, cc: "+1 (919) 555-0142" }), null);
});

test("parseCcPhone: blank clears, a number is stored in E.164", () => {
  assert.deepEqual(parseCcPhone("", "9195550142"), { value: null });
  assert.deepEqual(parseCcPhone("   ", "9195550142"), { value: null });
  assert.deepEqual(parseCcPhone("(919) 555-0188", "9195550142"), { value: "+19195550188" });
});

test("parseCcPhone refuses a bad number and the customer's own", () => {
  assert.ok("error" in parseCcPhone("555-0188", "9195550142"));
  assert.ok("error" in parseCcPhone("919.555.0142", "(919) 555-0142"));
});
