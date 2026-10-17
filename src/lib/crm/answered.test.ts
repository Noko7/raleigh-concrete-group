import assert from "node:assert/strict";
import { test } from "node:test";

import { offlineAcceptanceRefusal, repeatAnswer, unansweredFilter } from "./answered.ts";

// The race these exist for: two approvals both passing the "already answered" check. The loser's
// conditional write matches no row and is answered with these same verdicts, so it must never read as
// a second approval (a second text, a second price calculation).

test("the same answer again is a silent success", () => {
  assert.deepEqual(repeatAnswer("accepted", "accept"), { ok: true, duplicate: true });
  assert.deepEqual(repeatAnswer("declined", "decline"), { ok: true, duplicate: true });
});

test("a different answer is refused, naming the one on file", () => {
  const flip = repeatAnswer("accepted", "decline");
  assert.equal(flip.ok, false);
  assert.match("error" in flip ? flip.error : "", /already approved/);
  const back = repeatAnswer("declined", "accept");
  assert.equal(back.ok, false);
  assert.match("error" in back ? back.error : "", /already declined/);
});

test("the write is filtered to the state that was checked", () => {
  assert.equal(unansweredFilter(false), "&customer_response=is.null");
  // A reopened decline is the one answered row the customer may still write over.
  assert.equal(unansweredFilter(true), "&customer_response=eq.declined&status=neq.lost");
});

test("an offline approval needs an unanswered, open quote", () => {
  assert.equal(offlineAcceptanceRefusal({ customer_response: null, status: "quoted" }), null);
  assert.match(offlineAcceptanceRefusal({ customer_response: "accepted", status: "approved" }) ?? "", /already marked approved/);
  assert.match(offlineAcceptanceRefusal({ customer_response: "declined", status: "quoted" }) ?? "", /marked declined/);
  assert.match(offlineAcceptanceRefusal({ customer_response: null, status: "lost" }) ?? "", /marked declined/);
  assert.match(offlineAcceptanceRefusal({ customer_response: null, status: "paid" }) ?? "", /closed out/);
  assert.match(offlineAcceptanceRefusal({ customer_response: null, status: "completed" }) ?? "", /closed out/);
});
