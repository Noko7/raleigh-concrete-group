// DocuSeal signing: a forged or stale webhook is refused, the request sends the saved version untouched, and an
// agreement only ever moves forward. A mistake here signs the wrong document or the wrong way round.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSubmissionRequest,
  customerStage,
  parseEvent,
  readSigners,
  signDocuseal,
  transitionFor,
  verifyDocusealSignature,
  type DocusealEvent,
} from "./docuseal-core.ts";

const SECRET = "whsec_c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0";
const body = JSON.stringify({ event_type: "form.completed", timestamp: "2026-10-31T12:00:00Z", data: { id: 1 } });

test("signature: DocuSeal's own scheme verifies", () => {
  const now = 1_793_500_000;
  assert.deepEqual(verifyDocusealSignature({ secret: SECRET, rawBody: body, header: signDocuseal(SECRET, body, now), nowSeconds: now }), { ok: true });
});

test("signature: wrong secret, changed body, stale, future, garbage and missing are all refused", () => {
  const now = 1_793_500_000;
  const good = signDocuseal(SECRET, body, now);
  const v = (over: Partial<Parameters<typeof verifyDocusealSignature>[0]>) => verifyDocusealSignature({ secret: SECRET, rawBody: body, header: good, nowSeconds: now, ...over }).ok;
  assert.equal(v({ secret: "whsec_other" }), false);
  assert.equal(v({ rawBody: body.replace("1", "2") }), false);
  assert.equal(v({ nowSeconds: now + 301 }), false);
  assert.equal(v({ nowSeconds: now - 301 }), false);
  assert.equal(v({ nowSeconds: now + 300 }), true);
  assert.equal(v({ header: "abc" }), false);
  assert.equal(v({ header: `${now}.${"0".repeat(64)}` }), false);
  assert.equal(v({ header: null }), false);
  assert.equal(v({ secret: "" }), false);
});

test("send: the saved HTML goes as is, contractor first, no DocuSeal emails, fingerprint in metadata", () => {
  const html = "<!DOCTYPE html><html><body><p>x</p></body></html>";
  const r = buildSubmissionRequest({
    agreementId: "a1",
    version: { id: "v1", version_no: 3, html, html_sha256: "f".repeat(64) },
    title: "Agreement · Josh Joyner · 5604 Merion",
    contractor: { name: "Mike", email: "mike@example.com", phone: "+19195550199" },
    customer: { name: "Josh", email: "not-an-email", phone: "(919) 555-0100" },
    expireAt: "2026-11-30T12:00:00.000Z",
  }) as { send_email: boolean; order: string; documents: { html: string }[]; submitters: Record<string, unknown>[] };
  assert.equal(r.documents[0].html, html);
  assert.equal(r.send_email, false);
  assert.equal(r.order, "preserved");
  assert.deepEqual(r.submitters.map((s) => [s.role, s.order, s.send_email]), [["Contractor", 0, false], ["Customer", 1, false]]);
  assert.equal(r.submitters[1].email, undefined, "a bad email is left out, not sent");
  assert.equal(r.submitters[1].phone, undefined, "only E.164 phones are sent");
  assert.deepEqual(r.submitters[0].metadata, { agreement_id: "a1", version_id: "v1", version_no: 3, html_sha256: "f".repeat(64) });
});

test("response: both signers read with their embed links; anything incomplete is refused", () => {
  const sub = (role: string, id: number) => ({ id, submission_id: 77, role, slug: `s${id}`, embed_src: `https://docuseal.com/s/s${id}`, name: role, email: null, phone: null, completed_at: null, declined_at: null });
  const ok = readSigners([sub("Contractor", 1), sub("Customer", 2)]);
  assert.equal(ok?.submissionId, 77);
  assert.deepEqual(ok?.signers.map((s) => s.role), ["Contractor", "Customer"]);
  assert.equal(readSigners({ id: 77, submitters: [sub("Contractor", 1), sub("Customer", 2)] })?.submissionId, 77);
  assert.equal(readSigners([sub("Contractor", 1)]), null);
  assert.equal(readSigners([sub("Contractor", 1), sub("Contractor", 2)]), null);
  assert.equal(readSigners([{ ...sub("Contractor", 1), embed_src: null }, sub("Customer", 2)]), null);
});

test("webhooks: form and submission events are read, junk is not", () => {
  const f = parseEvent({ event_type: "form.declined", timestamp: "2026-10-31T12:00:00Z", data: { submission_id: 77, role: "Customer", decline_reason: "Price too high" } });
  assert.equal(f?.submissionId, 77);
  assert.equal(f?.role, "Customer");
  assert.equal(f?.declineReason, "Price too high");
  const s = parseEvent({ event_type: "submission.completed", timestamp: "2026-10-31T12:00:00Z", data: { id: 77, audit_log_url: "https://x/a", combined_document_url: "https://x/c", documents: [{ url: "https://x/d" }] } });
  assert.equal(s?.submissionId, 77);
  assert.equal(s?.combinedDocumentUrl, "https://x/c");
  assert.deepEqual(s?.documentUrls, ["https://x/d"]);
  assert.equal(parseEvent({ event_type: "form.completed", data: { submission_id: 77 } }), null, "no timestamp");
  assert.equal(parseEvent({ event_type: "form.completed", timestamp: "2026-10-31T12:00:00Z", data: {} }), null);
  assert.equal(parseEvent("nope"), null);
});

const ev = (type: string, role: "Contractor" | "Customer" | null = null): DocusealEvent => ({
  type, at: "2026-10-31T12:00:00.000Z", submissionId: 77, role, declineReason: null, auditLogUrl: null, combinedDocumentUrl: null, documentUrls: [],
});

test("status: only forward, only while out for signature", () => {
  assert.deepEqual(transitionFor("sent", ev("form.completed", "Contractor")), { kind: "contractor_signed" });
  assert.deepEqual(transitionFor("contractor_signed", ev("form.completed", "Contractor")), { kind: "none" }, "a retry");
  assert.deepEqual(transitionFor("contractor_signed", ev("form.completed", "Customer")), { kind: "signed" });
  assert.deepEqual(transitionFor("contractor_signed", ev("submission.completed")), { kind: "signed" });
  assert.deepEqual(transitionFor("sent", ev("form.declined", "Contractor")), { kind: "declined", reason: null, role: "Contractor" });
  assert.deepEqual(transitionFor("contractor_signed", ev("submission.expired")), { kind: "expired" });
  assert.deepEqual(transitionFor("signed", ev("form.declined", "Customer")), { kind: "none" }, "signed is final");
  assert.deepEqual(transitionFor("void", ev("submission.completed")), { kind: "none" });
  assert.deepEqual(transitionFor("pending", ev("form.completed", "Customer")), { kind: "none" }, "a cancelled send");
  assert.deepEqual(transitionFor("sent", ev("form.viewed", "Contractor")), { kind: "none" });
});

test("the customer can sign only after the contractor", () => {
  assert.equal(customerStage("sent"), "waiting");
  assert.equal(customerStage("contractor_signed"), "sign");
  assert.equal(customerStage("signed"), "done");
  for (const s of ["pending", "declined", "expired", "void"] as const) assert.equal(customerStage(s), "closed");
});
