// The quote funnel's arithmetic, and the check on what a browser may send.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFunnelEvent, scrubPath } from "./funnel.ts";
import { formatMs, funnelStats, median, type FunnelRow } from "./funnel-stats.ts";

function row(attempt: string, event: FunnelRow["event"], extra: Partial<FunnelRow> = {}): FunnelRow {
  return {
    attempt_id: attempt,
    visitor_id: `v-${attempt}`,
    form: "modal",
    event,
    step: null,
    ms: null,
    mode: null,
    detail: null,
    path: null,
    device: "mobile",
    ...extra,
  };
}

test("median is the middle value, and the mean of the middle two", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 2, 3, 10]), 3);
});

test("counts each attempt once per step, however often it passed through", () => {
  const rows: FunnelRow[] = [
    // A: all the way through, bounced back to contact once by the server.
    row("a", "open", { path: "/raleigh" }),
    row("a", "view", { step: "choice" }),
    row("a", "done", { step: "choice", ms: 2000, mode: "online" }),
    row("a", "view", { step: "contact", mode: "online" }),
    row("a", "done", { step: "contact", ms: 40000, mode: "online" }),
    row("a", "view", { step: "service", mode: "online" }),
    row("a", "done", { step: "service", ms: 20000, mode: "online" }),
    row("a", "view", { step: "schedule", mode: "online" }),
    row("a", "error", { step: "schedule", detail: "server_phone", mode: "online" }),
    row("a", "view", { step: "contact", mode: "online" }),
    row("a", "done", { step: "contact", ms: 10000, mode: "online" }),
    row("a", "view", { step: "service", mode: "online" }),
    row("a", "view", { step: "schedule", mode: "online" }),
    row("a", "submit", { step: "schedule", ms: 120000, mode: "online" }),
    // B: gave up on contact with the address unfinished, closed twice.
    row("b", "open", { path: "/raleigh" }),
    row("b", "view", { step: "choice" }),
    row("b", "done", { step: "choice", ms: 3000, mode: "inperson" }),
    row("b", "view", { step: "contact", mode: "inperson" }),
    row("b", "close", { step: "contact", ms: 60000, detail: "address", mode: "inperson" }),
    row("b", "close", { step: "contact", ms: 61000, detail: "left_page", mode: "inperson" }),
    // C: its open beacon was lost; closed on the first screen.
    row("c", "view", { step: "choice", device: "desktop" }),
    row("c", "close", { step: "choice", ms: 1000, device: "desktop" }),
  ];
  const s = funnelStats(rows);

  assert.equal(s.opened, 3);
  assert.equal(s.visitors, 3);
  assert.equal(s.submitted, 1);
  assert.equal(s.medianSubmitMs, 120000);

  const byStep = Object.fromEntries(s.steps.map((x) => [x.step, x]));
  assert.deepEqual(
    [byStep.choice.reached, byStep.contact.reached, byStep.service.reached, byStep.schedule.reached],
    [3, 2, 1, 1],
  );
  assert.equal(byStep.choice.completed, 2);
  assert.equal(byStep.contact.completed, 1);
  // Submitting is completing the last step, without a separate done event.
  assert.equal(byStep.schedule.completed, 1);
  assert.equal(byStep.contact.closedHere, 1);
  assert.equal(byStep.choice.closedHere, 1);
  assert.equal(byStep.contact.medianMs, 25000);
  assert.equal(byStep.contact.medianCloseMs, 60000);

  // Only the first close of an attempt is a reason.
  assert.deepEqual(s.closeReasons, [
    { key: "choice", count: 1 },
    { key: "contact · address", count: 1 },
  ]);
  assert.deepEqual(s.errors, [{ key: "schedule · server_phone", count: 1 }]);
  assert.deepEqual(s.byMode, [
    { key: "inperson", opened: 1, submitted: 0 },
    { key: "online", opened: 1, submitted: 1 },
  ]);
  assert.deepEqual(s.byPath, [{ key: "/raleigh", opened: 2, submitted: 1 }]);
  assert.deepEqual(s.byDevice, [
    { key: "mobile", opened: 2, submitted: 1 },
    { key: "desktop", opened: 1, submitted: 0 },
  ]);
});

test("a secret in the path never reaches the table", () => {
  assert.equal(scrubPath("/q/abc123def456"), "/q/[token]");
  assert.equal(scrubPath("/pay/abc123/done"), "/pay/[token]/done");
  assert.equal(scrubPath("/services/patios?x=1"), "/services/patios");
  assert.equal(scrubPath("/"), "/");
});

test("parseFunnelEvent keeps what it recognises and drops what it doesn't", () => {
  const good = {
    attempt_id: "abcd1234-ef",
    visitor_id: "visitor-0001",
    form: "modal",
    event: "close",
    step: "contact",
    ms: 12.6,
    mode: "online",
    detail: "phone+address",
    path: "/q/deadbeefdeadbeef",
    device: "mobile",
  };
  assert.deepEqual(parseFunnelEvent(good), { ...good, ms: 13, path: "/q/[token]" });

  assert.equal(parseFunnelEvent({ ...good, event: "delete" }), null);
  assert.equal(parseFunnelEvent({ ...good, attempt_id: "x" }), null);
  assert.equal(parseFunnelEvent(null), null);

  const odd = parseFunnelEvent({ ...good, step: "admin", ms: -5, mode: "x", detail: "<script>", path: "http://x", device: "tv" });
  assert.deepEqual(
    [odd?.step, odd?.ms, odd?.mode, odd?.detail, odd?.path, odd?.device],
    [null, null, null, null, null, "desktop"],
  );
  assert.equal(parseFunnelEvent({ ...good, ms: 1e12 })?.ms, 3600000);
});

test("formatMs", () => {
  assert.equal(formatMs(null), "-");
  assert.equal(formatMs(4400), "4s");
  assert.equal(formatMs(125000), "2m 05s");
});
