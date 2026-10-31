// The Documents hub groups every agreement and receipt by job, and each job page shows one line about them.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { agreementHeadline, docsLine, groupByJob, shownStatus, type DocAgreement, type DocReceipt } from "./documents.ts";

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

test("who may write a job's agreement: the owner, or the contractor on the job", async () => {
  const { canEditJobAgreement } = await import("./documents.ts");
  const s = (id: string, role: string) => ({ staff: { id, role } }) as never;
  assert.equal(canEditJobAgreement(s("o", "owner"), { assigned_to: null }), true);
  assert.equal(canEditJobAgreement(s("c1", "contractor"), { assigned_to: "c1" }), true);
  assert.equal(canEditJobAgreement(s("c2", "contractor"), { assigned_to: "c1" }), false);
  assert.equal(canEditJobAgreement(s("c2", "contractor"), { assigned_to: null }), false);
});

test("the agreement the editor works on: newest written in the CRM, never an uploaded file", async () => {
  const { editableAgreement } = await import("./documents.ts");
  const a = (id: string, created_at: string, current_version_id: string | null, kind = "customer") => ({ id, created_at, current_version_id, kind }) as never;
  assert.equal(editableAgreement([a("file", "2026-10-30", null)]), null);
  assert.equal(editableAgreement([a("v1", "2026-10-01", "x"), a("v2", "2026-10-20", "y"), a("file", "2026-10-30", null)])?.["id" as never], "v2");
});

test("an agreement set aside (void) is never the one the editor works on", async () => {
  const { editableAgreement } = await import("./documents.ts");
  const a = (id: string, created_at: string, status: string) => ({ id, created_at, current_version_id: "x", kind: "customer", status }) as never;
  assert.equal(editableAgreement([a("old", "2026-10-01", "void")]), null);
  assert.equal(editableAgreement([a("new", "2026-10-20", "pending"), a("old", "2026-10-30", "void")])?.["id" as never], "new");
});

test("a CRM agreement voided to start over reads 'set aside'; a void file still reads 'void'", () => {
  assert.equal(shownStatus({ status: "void", current_version_id: "v1" }), "set_aside");
  assert.equal(shownStatus({ status: "void", current_version_id: null }), "void");
  assert.equal(shownStatus({ status: "pending", current_version_id: "v1" }), "pending");
  const [job] = groupByJob([ag({ status: "void", current_version_id: "v1" })], []);
  assert.equal(job?.agreement, "set_aside");
  assert.equal(docsLine({ agreement: "set_aside", receipts: 0 }), "Agreement set aside");
  // The agreement written after setting one aside is what the job shows.
  assert.equal(agreementHeadline(["set_aside", "pending"]), "pending");
});
