// The Documents hub groups every agreement and receipt by job, and each job page shows one line about them.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { agreementHeadline, docsLine, groupByJob, type DocAgreement, type DocReceipt } from "./documents.ts";

const ag = (over: Partial<DocAgreement>): DocAgreement => ({
  id: "a",
  kind: "customer",
  quote_id: "q1",
  status: "pending",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});
const rc = (over: Partial<DocReceipt>): DocReceipt => ({
  id: "r",
  quote_id: "q1",
  amount_cents: 1000,
  issued_at: "2026-10-02T00:00:00Z",
  voided_at: null,
  is_test: false,
  ...over,
});

test("the agreement that speaks for a job: signed, then sent, then not sent", () => {
  assert.equal(agreementHeadline([]), null);
  assert.equal(agreementHeadline(["void", "signed", "pending"]), "signed");
  assert.equal(agreementHeadline(["declined", "sent"]), "sent");
  assert.equal(agreementHeadline(["void", "declined"]), "declined");
});

test("grouping: one entry per job, voided receipts counted out, newest activity first", () => {
  const jobs = groupByJob(
    [ag({ quote_id: "q1", status: "signed" }), ag({ kind: "contractor", quote_id: null })],
    [
      rc({ id: "r1", quote_id: "q1", amount_cents: 5000 }),
      rc({ id: "r2", quote_id: "q1", amount_cents: 7000, voided_at: "2026-10-05T00:00:00Z" }),
      rc({ id: "r3", quote_id: "q2", amount_cents: 3000, issued_at: "2026-10-03T00:00:00Z" }),
    ],
  );
  assert.deepEqual(
    jobs.map((j) => j.quoteId),
    ["q1", "q2"],
    "q1's void on Oct 5 is its latest activity",
  );
  assert.equal(jobs[0].agreement, "signed");
  assert.equal(jobs[0].receipts, 1);
  assert.equal(jobs[0].receivedCents, 5000);
  assert.equal(jobs[1].agreement, null);
  assert.equal(jobs[1].receipts, 1);
});

test("an onboarding agreement is not a job", () => {
  assert.deepEqual(groupByJob([ag({ kind: "contractor", quote_id: null })], []), []);
});

test("the job page line", () => {
  assert.equal(docsLine(null), "No documents yet");
  assert.equal(docsLine({ agreement: null, receipts: 0 }), "No documents yet");
  assert.equal(docsLine({ agreement: "signed", receipts: 2 }), "Agreement signed · 2 receipts");
  assert.equal(docsLine({ agreement: null, receipts: 1 }), "1 receipt");
  assert.equal(docsLine({ agreement: "sent", receipts: 0 }), "Agreement awaiting signature");
});
