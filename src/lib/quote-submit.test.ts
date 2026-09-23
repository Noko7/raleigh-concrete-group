// The one check that decides whether a customer is told their request arrived.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { isConfirmedSave, leadReference, newSubmissionId, UUID_RE } from "./quote-submit.ts";

const ID = "3f2b8c1e-9a4d-4e7f-8b2c-1d5e6f7a8b9c";

test("only a saved row with an id is a success", () => {
  assert.equal(isConfirmedSave(200, { ok: true, saved: true, lead_id: ID }), true);
  assert.equal(isConfirmedSave(201, { ok: true, saved: true, lead_id: ID, duplicate: true }), true);
});

test("every response that used to show a fake success screen is now a failure", () => {
  // The old spam-trap and "demo" answers.
  assert.equal(isConfirmedSave(200, { ok: true }), false);
  assert.equal(isConfirmedSave(200, { ok: true, demo: true }), false);
  // ok without saved, saved without an id, an id that isn't one.
  assert.equal(isConfirmedSave(200, { ok: true, lead_id: ID }), false);
  assert.equal(isConfirmedSave(200, { ok: true, saved: true }), false);
  assert.equal(isConfirmedSave(200, { ok: true, saved: true, lead_id: "" }), false);
  assert.equal(isConfirmedSave(200, { ok: true, saved: true, lead_id: "not-a-uuid" }), false);
  // Truthy-but-not-true values must not pass.
  assert.equal(isConfirmedSave(200, { ok: "true", saved: 1, lead_id: ID }), false);
  // Right body, wrong status: a proxy or a 202 is not a save.
  assert.equal(isConfirmedSave(202, { ok: true, saved: true, lead_id: ID }), false);
  assert.equal(isConfirmedSave(500, { ok: true, saved: true, lead_id: ID }), false);
  // Nothing readable at all.
  assert.equal(isConfirmedSave(200, null), false);
  assert.equal(isConfirmedSave(200, "ok"), false);
  assert.equal(isConfirmedSave(200, undefined), false);
});

test("leadReference is short, stable and readable", () => {
  assert.equal(leadReference(ID), "3F2B8C1E");
});

test("newSubmissionId produces ids the server will accept", () => {
  for (let i = 0; i < 50; i++) assert.match(newSubmissionId(), UUID_RE);
  assert.notEqual(newSubmissionId(), newSubmissionId());
});
