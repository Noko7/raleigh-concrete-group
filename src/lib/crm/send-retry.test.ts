import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SEND_ATTEMPTS, planRetry } from "./send-retry.ts";

// The regression these exist for: a missing QUO_API_KEY used to look identical
// to a call that threw mid-flight, so the queue treated a message it had
// definitely not sent as one that might have arrived - and burned it. Every
// case below is a thing we know, and what the queue is allowed to conclude.

test("a delivered send is finished, with nothing to add", () => {
  const p = planRetry({ ok: true, status: 202 }, 0);
  assert.equal(p.retrying, false);
  assert.equal(p.note, null);
  assert.equal(p.attempts, 1);
});

test("a provider refusal is retried until the cap", () => {
  assert.equal(planRetry({ ok: false, status: 500 }, 0).retrying, true);
  assert.equal(planRetry({ ok: false, status: 500 }, 1).retrying, true);
  // The third attempt is the last one, so it does not go back.
  assert.equal(planRetry({ ok: false, status: 500 }, MAX_SEND_ATTEMPTS - 1).retrying, false);
});

test("a refusal spends an attempt each time, and never exceeds the cap", () => {
  assert.equal(planRetry({ ok: false, status: 500 }, 0).attempts, 1);
  assert.equal(planRetry({ ok: false, status: 500 }, 1).attempts, 2);
  assert.equal(planRetry({ ok: false, status: 500 }, MAX_SEND_ATTEMPTS).attempts, MAX_SEND_ATTEMPTS);
});

test("a send that threw is never retried - it may have arrived", () => {
  const p = planRetry({ ok: false }, 0);
  assert.equal(p.retrying, false);
  assert.match(p.note ?? "", /cannot tell whether it arrived/);
});

test("a send we never made is always retried, and costs nothing", () => {
  // The config-error case. It did not send, we know it did not send, and the
  // fix is an environment variable rather than anything about this message.
  // Only counts below the cap: an unsent try never increments the budget, so a
  // row cannot climb to the cap this way. Reaching it means earlier REFUSALS
  // spent it, and the next test covers that boundary.
  for (const attempts of [0, 1, MAX_SEND_ATTEMPTS - 1]) {
    const p = planRetry({ ok: false, unsent: true }, attempts);
    assert.equal(p.retrying, true, `attempts=${attempts}`);
    assert.equal(p.attempts, attempts, "an unsent try must not spend the budget");
  }
});

test("an unsent row says so, rather than claiming the outcome is unknown", () => {
  const p = planRetry({ ok: false, unsent: true }, 0);
  assert.match(p.note ?? "", /Nothing was sent/);
  assert.doesNotMatch(p.note ?? "", /cannot tell/);
});

test("a caller can declare a row terminal by handing over a spent count", () => {
  // Used for a held row with no number or body: nothing to attempt, so it is
  // not annotated as though something was tried.
  const p = planRetry({ ok: false }, MAX_SEND_ATTEMPTS);
  assert.equal(p.retrying, false);
  assert.equal(p.note, null);
});

test("terminal beats unsent, so a spent row cannot loop for ever", () => {
  assert.equal(planRetry({ ok: false, unsent: true }, MAX_SEND_ATTEMPTS).retrying, false);
});

test("ok wins over unsent, in case a provider ever sets both", () => {
  const p = planRetry({ ok: true, unsent: true }, 0);
  assert.equal(p.retrying, false);
  assert.equal(p.note, null);
});
