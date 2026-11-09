// Retry on a failed text: allowed once it truly failed, never into a pile of texts.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { retryRefusal, type RetryableText } from "./retry-text.ts";

const NOW = Date.parse("2026-11-09T18:00:00Z");
const base: RetryableText = {
  id: "a",
  created_at: "2026-11-09T12:00:00Z",
  kind: "visit_booked",
  to_phone: "+19195550100",
  body: "Hi Ray, confirming your free estimate",
  ok: false,
};
const row = (o: Partial<RetryableText>): RetryableText => ({ ...base, ...o });

test("a plain failure can be retried", () => {
  assert.equal(retryRefusal(base, [base], NOW), null);
});

test("sent, held and cancelled texts can't", () => {
  assert.ok(retryRefusal(row({ ok: true }), [], NOW));
  assert.ok(retryRefusal(row({ send_after: "2026-11-10T13:00:00Z" }), [], NOW));
  assert.ok(retryRefusal(row({ cancelled_at: "2026-11-09T12:01:00Z" }), [], NOW));
  assert.ok(retryRefusal(row({ to_phone: null }), [], NOW));
  assert.ok(retryRefusal(row({ body: "" }), [], NOW));
});

test("older than 2 days is refused", () => {
  assert.match(retryRefusal(row({ created_at: "2026-11-07T12:00:00Z" }), [], NOW)!, /2 days/);
});

test("a newer sent or waiting text of the same kind to the same number blocks it", () => {
  const later = row({ id: "b", created_at: "2026-11-09T13:00:00Z", ok: true });
  assert.match(retryRefusal(base, [base, later], NOW)!, /newer text/);
  const waiting = row({ id: "c", created_at: "2026-11-09T13:00:00Z", send_after: "2026-11-10T13:00:00Z" });
  assert.match(retryRefusal(base, [base, waiting], NOW)!, /newer text/);
  // A different number, or a different kind, doesn't.
  assert.equal(retryRefusal(base, [base, row({ id: "d", to_phone: "+19195550199", ok: true, created_at: "2026-11-09T13:00:00Z" })], NOW), null);
  assert.equal(retryRefusal(base, [base, row({ id: "e", kind: "visit_reminder", ok: true, created_at: "2026-11-09T13:00:00Z" })], NOW), null);
});

test("retry the newest failure, and at most 3 a day", () => {
  const second = row({ id: "b", created_at: "2026-11-09T13:00:00Z" });
  assert.match(retryRefusal(base, [base, second], NOW)!, /newer try/);
  const third = row({ id: "c", created_at: "2026-11-09T14:00:00Z" });
  assert.match(retryRefusal(third, [base, second, third], NOW)!, /3 times/);
  assert.equal(retryRefusal(second, [base, second], NOW), null);
});
