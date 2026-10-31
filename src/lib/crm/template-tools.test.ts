// The template editor's helpers: new section ids, moving sections, and the diff between two template versions.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { draftAgreement, parseTemplateBody, renderAgreementHtml } from "./agreement-doc.ts";
import { REPAIR_SEED, STANDARD_SEED } from "./template-seeds.ts";
import { BLANK_TEMPLATE, SAMPLE_JOB, diffTemplates, moveClause, newClause, newClauseId } from "./template-tools.ts";

test("new section ids are slugs, unique, and valid", () => {
  assert.equal(newClauseId("Site Access & Parking", []), "clause.site_access_parking");
  assert.equal(newClauseId("Site Access", ["clause.site_access"]), "clause.site_access_2");
  assert.equal(newClauseId("!!!", []), "clause.section");
  const t = { ...BLANK_TEMPLATE, clauses: [{ ...newClause("Dogs", []), text: "Keep pets inside." }, ...BLANK_TEMPLATE.clauses] };
  assert.ok(parseTemplateBody(t).ok);
});

test("a blank template is valid and renders an agreement with only Authorization", () => {
  assert.ok(parseTemplateBody(BLANK_TEMPLATE).ok);
  const d = draftAgreement({ ...SAMPLE_JOB, template: { ...BLANK_TEMPLATE, id: null, version_no: null, name: "Blank" } });
  assert.deepEqual(d.blocks.filter((b) => b.kind !== "work").map((b) => b.id), ["clause.authorization"]);
  assert.equal((renderAgreementHtml(d).match(/<signature-field /g) ?? []).length, 2);
});

test("moving sections", () => {
  const t = STANDARD_SEED.body;
  const moved = moveClause(t, t.clauses[1].id, -1);
  assert.equal(moved.clauses[0].id, t.clauses[1].id);
  assert.equal(moveClause(t, t.clauses[0].id, -1), t, "can't go above the top");
});

test("template diff: tax default, order, flags, text and removed/added sections", () => {
  const a = STANDARD_SEED.body;
  const b = REPAIR_SEED.body;
  const keys = diffTemplates(a, b).map((c) => (c.kind === "value" ? c.key : `${c.change}:${c.id}`));
  assert.ok(keys.includes("tax_mode"));
  assert.ok(keys.includes("removed:clause.warranty"));
  assert.ok(keys.includes("clause.repair.optional"));
  assert.ok(keys.includes("edited:clause.cancel"));
  assert.ok(keys.includes("edited:clause.authorization"));
  assert.deepEqual(diffTemplates(a, a), []);
});
