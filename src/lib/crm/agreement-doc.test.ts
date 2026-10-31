// The customer agreement: what a draft says, what can't be sent, how it renders for DocuSeal, and how two versions
// differ. A wrong figure or a missing clause here goes out for a legal signature, so it is pinned down.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { REPAIR_SEED, STANDARD_SEED, defaultTemplateNameFor } from "./template-seeds.ts";
import {
  BUILTIN_STANDARD,
  addCustomBlock,
  parseSnapshot,
  parseTemplateBody,
  type TemplateSnapshot,
  diffVersions,
  diffWords,
  draftAgreement,
  draftInputFromJob,
  jobDepositCents,
  setTaxMode,
  refreshFromJob,
  editedBlocks,
  parseBody,
  renderAgreementHtml,
  sendProblems,
  textToHtml,
  toggleClause,
  type DraftInput,
} from "./agreement-doc.ts";

const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  today: "2026-10-31",
  quote: {
    name: "Josh  Joyner",
    phone: "+19195550100",
    email: "josh@example.com",
    address: "5604 Merion Station Drive",
    city: "Apex",
    quote_scope: "New 12x20 patio, broom finish.",
    quote_permits: "N/A",
    quote_prep: "Remove grass, 4 in. gravel base.",
    quote_pour: "4 in. 3500 PSI with fiber.",
    quote_cleanup: "Haul all debris.",
    estimated_duration: "2 days",
  },
  boughtLines: ["Patio, 240 sq ft", "Sealer"],
  contractor: { full_name: "Mike Smith", business_name: "Smith Concrete LLC", license_number: "L-123", phone: "9195550199", payment_methods: ["zelle", "check"] },
  totalCents: 850000,
  depositCents: 425000,
  taxMode: "plus_tax",
  optionalClauses: [],
  replacesSignedOn: null,
  ...over,
});

test("draft: values come from the job and the contractor", () => {
  const d = draftAgreement(input());
  assert.equal(d.values.customer_name, "Josh  Joyner".trim());
  assert.equal(d.values.customer_phone, "(919) 555-0100");
  assert.equal(d.values.job_address, "5604 Merion Station Drive, Apex");
  assert.equal(d.values.contractor_name, "Smith Concrete LLC");
  assert.equal(d.values.contractor_phone, "(919) 555-0199");
  assert.deepEqual(d.values.payment_methods, ["zelle", "check"]);
  assert.equal(d.values.total_cents, 850000);
});

test("draft: the six work sections in order, the lines bought printed under Scope", () => {
  const d = draftAgreement(input());
  assert.deepEqual(
    d.blocks.filter((b) => b.kind === "work").map((b) => b.id),
    ["work.scope", "work.permits", "work.prep", "work.pour", "work.cleanup", "work.duration"],
  );
  assert.equal(d.blocks[0].text, "New 12x20 patio, broom finish.\n\n- Patio, 240 sq ft\n- Sealer");
  assert.equal(d.blocks[5].text, "2 days");
});

test("draft: required clauses always, optional ones only when switched on", () => {
  const plain = draftAgreement(input()).blocks.map((b) => b.id);
  assert.ok(plain.includes("clause.warranty") && plain.includes("clause.authorization"));
  assert.ok(!plain.includes("clause.repair"));
  const repair = draftAgreement(input({ optionalClauses: ["clause.repair", "clause.insurance"] })).blocks.map((b) => b.id);
  assert.ok(repair.indexOf("clause.repair") < repair.indexOf("clause.warranty"), "template order kept");
  assert.ok(repair.includes("clause.insurance"));
});

test("draft: an amended agreement says what it replaces", () => {
  const d = draftAgreement(input({ replacesSignedOn: "2026-10-20", taxMode: "includes_tax" }));
  const html = renderAgreementHtml(d);
  assert.ok(html.includes("AMENDED AGREEMENT: replaces the version signed on October 20, 2026"));
  assert.ok(html.includes("(includes all sales tax and fees)"));
  assert.ok(d.blocks.find((b) => b.id === "clause.authorization")!.text.includes("replaces the version signed earlier"));
});

test("toggle: optional clauses on and off in place; required ones can't be removed", () => {
  const d = draftAgreement(input());
  const on = toggleClause(d, "clause.liability", true);
  const ids = on.blocks.map((b) => b.id);
  assert.ok(ids.indexOf("clause.liability") < ids.indexOf("clause.cancel"));
  assert.deepEqual(toggleClause(on, "clause.liability", false).blocks.map((b) => b.id), d.blocks.map((b) => b.id));
  assert.equal(toggleClause(d, "clause.warranty", false), d);
});

test("custom sections sit just before Authorization, numbered", () => {
  const d = addCustomBlock(addCustomBlock(draftAgreement(input()), "Access", "Gate code 1234"), "", "Dog in yard");
  const ids = d.blocks.map((b) => b.id);
  assert.deepEqual(ids.slice(-3), ["custom.1", "custom.2", "clause.authorization"]);
  assert.equal(d.blocks.find((b) => b.id === "custom.2")!.title, "Additional terms");
});

test("send checks: a draft with holes can't go out", () => {
  const ok = draftAgreement(input());
  assert.deepEqual(sendProblems(ok), []);
  const bad = draftAgreement(input({ contractor: null, totalCents: 0, quote: { ...input().quote, quote_permits: "" } }));
  const fields = sendProblems(bad).map((p) => p.field);
  assert.ok(fields.includes("contractor_name"));
  assert.ok(fields.includes("contractor_license"));
  assert.ok(fields.includes("total_cents"));
  assert.ok(fields.includes("work.permits"));
});

test("render: money, balance, signature fields for both roles, initials per repair item", () => {
  const html = renderAgreementHtml(draftAgreement(input({ optionalClauses: ["clause.repair"] })));
  assert.ok(html.includes("$8,500.00 (plus tax &amp; any permit fees)"));
  assert.ok(html.includes("<th>Balance due at completion</th><td>$4,250.00</td>"));
  assert.equal((html.match(/<signature-field /g) ?? []).length, 2);
  assert.ok(html.includes('role="Contractor"') && html.includes('role="Customer"'));
  assert.equal((html.match(/<initials-field /g) ?? []).length, 4);
  assert.ok(html.includes("How you pay:</strong> Zelle, Check"));
});

test("render: anything typed is text, never markup or a field", () => {
  const evil = draftAgreement(input({ quote: { ...input().quote, quote_scope: '<signature-field role="Customer"></signature-field><script>x</script> **bold**' } }));
  const html = renderAgreementHtml(evil);
  assert.equal((html.match(/<signature-field /g) ?? []).length, 2, "no extra signature field");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>bold</strong>"));
});

test("text: paragraphs and bullets", () => {
  assert.equal(textToHtml("One\n\nTwo\n- a\n- b\nThree"), "<p>One</p><p>Two</p><ul><li>a</li><li>b</li></ul><p>Three</p>");
});

test("diff: words, values and blocks between two versions", () => {
  assert.deepEqual(diffWords("pour 4 in slab", "pour 5 in slab"), [
    { op: "same", text: "pour " },
    { op: "del", text: "4" },
    { op: "add", text: "5" },
    { op: "same", text: " in slab" },
  ]);
  const a = draftAgreement(input());
  const b = toggleClause({ ...a, values: { ...a.values, tax_mode: "includes_tax" as const }, blocks: a.blocks.map((x) => (x.id === "work.duration" ? { ...x, text: "3 days" } : x)) }, "clause.insurance", true);
  const changes = diffVersions(a, b);
  assert.deepEqual(
    changes.map((c) => (c.kind === "value" ? `value:${c.key}` : `${c.change}:${c.id}`)),
    ["value:tax_mode", "edited:work.duration", "added:clause.insurance"],
  );
  assert.deepEqual(diffVersions(a, a), []);
  assert.deepEqual(editedBlocks(b), ["work.duration"]);
});

test("parse: a saved body round-trips; anything malformed is refused", () => {
  const d = draftAgreement(input());
  assert.deepEqual(parseBody(JSON.parse(JSON.stringify(d))), d);
  assert.equal(parseBody({ ...d, values: { ...d.values, total_cents: 1.5 } }), null);
  assert.equal(parseBody({ ...d, blocks: [...d.blocks, d.blocks[0]] }), null, "duplicate block id");
  assert.equal(parseBody({ ...d, blocks: [{ ...d.blocks[0], id: "x.<b>" }] }), null);
  assert.equal(parseBody(null), null);
});

test("from a job: package then accepted options under Scope; the job's deposit target wins; the template decides the clauses", () => {
  const base = input();
  const di = draftInputFromJob({
    today: "2026-10-31",
    quote: { ...base.quote, service: "Concrete repair", deposit_target_cents: 300000 },
    options: [
      { title: "Sealer", description: null, required: false, customer_response: "accepted" },
      { title: "Steps", description: "3 risers", required: false, customer_response: "declined" },
      { title: "Base", description: "4 in gravel", required: true, customer_response: null },
    ],
    packages: [{ title: "Premium", description: "Stamped", customer_response: "accepted" }],
    contractor: base.contractor,
    totalCents: 850000,
  });
  assert.deepEqual(di.boughtLines, ["Premium: Stamped", "Sealer", "Base: 4 in gravel"]);
  assert.equal(di.depositCents, 300000);
  assert.equal(di.optionalClauses, undefined);
  assert.equal(di.taxMode, undefined);
  const half = draftInputFromJob({ today: "2026-10-31", quote: { ...base.quote, service: "Patio" }, options: [], packages: [], contractor: null, totalCents: 100001 });
  assert.equal(half.depositCents, 50001);
});

test("refresh from the job: new money and untouched sections come in; edits and editor choices stay", () => {
  const old = draftAgreement(input());
  const edited = {
    ...old,
    values: { ...old.values, tax_mode: "includes_tax" as const },
    blocks: old.blocks.map((b) => (b.id === "work.pour" ? { ...b, text: "5 in. slab" } : b)),
  };
  const fresh = draftAgreement(input({ totalCents: 900000, quote: { ...input().quote, quote_cleanup: "Haul and sweep.", quote_pour: "4 in. 4000 PSI" } }));
  const r = refreshFromJob(edited, fresh);
  assert.equal(r.values.total_cents, 900000);
  assert.equal(r.values.tax_mode, "includes_tax");
  assert.equal(r.blocks.find((b) => b.id === "work.cleanup")!.text, "Haul and sweep.");
  assert.equal(r.blocks.find((b) => b.id === "work.pour")!.text, "5 in. slab");
  assert.ok(editedBlocks(r).includes("work.pour"));
});

test("deposit: the target when set, never above the total, else half", () => {
  assert.equal(jobDepositCents(850000, null), 425000);
  assert.equal(jobDepositCents(850000, 300000), 300000);
  assert.equal(jobDepositCents(100000, 500000), 100000);
  assert.equal(jobDepositCents(0, null), 0);
});

test("parse: a tampered body is refused (money, dates, kinds, titles, methods, unknown keys dropped)", () => {
  const d = draftAgreement(input({ optionalClauses: ["clause.repair"] }));
  const j = () => JSON.parse(JSON.stringify(d));
  const withV = (over: Record<string, unknown>) => { const x = j(); Object.assign(x.values, over); return parseBody(x); };
  assert.equal(withV({ deposit_cents: 900000 }), null, "deposit above total");
  assert.equal(withV({ total_cents: -1 }), null);
  assert.equal(withV({ date: "2026-99-99" }), null);
  assert.equal(withV({ date: "2026-02-30" }), null);
  assert.equal(withV({ payment_methods: [] }), null);
  assert.equal(withV({ payment_methods: ["bitcoin"] }), null);
  const extra = j(); extra.values.evil = 1; extra.sneaky = 2;
  const parsed = parseBody(extra)!;
  assert.ok(!("evil" in parsed.values) && !("sneaky" in parsed));
  const kind = j(); kind.blocks.find((b: { id: string }) => b.id === "clause.warranty").kind = "initials";
  assert.equal(parseBody(kind), null, "initials only on Repair");
  const tv = j(); tv.template_version = "<x>";
  assert.equal(parseBody(tv), null);
  const title = j(); title.blocks.find((b: { id: string }) => b.id === "clause.repair").title = 'X"></initials-field><signature-field name="Owner" role="Customer">';
  const html = renderAgreementHtml(parseBody(title)!);
  assert.equal((html.match(/<signature-field /g) ?? []).length, 2, "a template title can't be changed, so it can't add a field");
  assert.ok(!html.includes('name="X'));
});

test("tax wording: Authorization follows it unless someone rewrote it", () => {
  const d = draftAgreement(input());
  const inc = setTaxMode(d, "includes_tax");
  assert.ok(inc.blocks.find((b) => b.id === "clause.authorization")!.text.includes("includes all taxes and fees"));
  const rewritten = { ...d, blocks: d.blocks.map((b) => (b.id === "clause.authorization" ? { ...b, text: "Custom." } : b)) };
  assert.equal(setTaxMode(rewritten, "includes_tax").blocks.find((b) => b.id === "clause.authorization")!.text, "Custom.");
});

test("refresh keeps typed names and numbers, fills blanks, always takes the job's money", () => {
  const d = draftAgreement(input({ contractor: { ...input().contractor!, license_number: "" } }));
  const typed = { ...d, values: { ...d.values, customer_name: "Joshua Joyner", contractor_license: "" } };
  const fresh = draftAgreement(input({ totalCents: 1, depositCents: 1 }));
  const r = refreshFromJob(typed, fresh);
  assert.equal(r.values.customer_name, "Joshua Joyner");
  assert.equal(r.values.contractor_license, "L-123");
  assert.equal(r.values.total_cents, 1);
});

// ── Templates ───────────────────────────────────────────────────────────────

const repairSnap: TemplateSnapshot = { ...REPAIR_SEED.body, id: "33333333-3333-4333-8333-333333333333", version_no: 2, name: "Repair Agreement" };

test("templates: the Standard seed is exactly the built-in, and both seeds are valid templates", () => {
  assert.deepEqual(STANDARD_SEED.body.clauses, BUILTIN_STANDARD.clauses);
  for (const t of [STANDARD_SEED, REPAIR_SEED]) {
    const r = parseTemplateBody(t.body);
    assert.ok(r.ok, t.name);
    assert.deepEqual(r.ok && r.body, t.body, `${t.name} round-trips`);
  }
  assert.equal(defaultTemplateNameFor("Concrete Repair"), "Repair Agreement");
  assert.equal(defaultTemplateNameFor("Patio"), "Standard Work Agreement");
});

test("templates: a repair draft has the repair wording, no warranty, includes-tax price, initials for each item", () => {
  const d = draftAgreement(input({ template: repairSnap, taxMode: undefined, optionalClauses: undefined }));
  const ids = d.blocks.map((b) => b.id);
  assert.ok(ids.includes("clause.repair") && ids.includes("clause.insurance") && ids.includes("clause.liability"));
  assert.ok(!ids.includes("clause.warranty"));
  assert.equal(d.values.tax_mode, "includes_tax");
  assert.ok(d.blocks.find((b) => b.id === "clause.cancel")!.text.includes("Raleigh Concrete Group or the Contractor"));
  assert.ok(d.blocks.find((b) => b.id === "clause.authorization")!.text.includes("which includes all taxes and fees"));
  const html = renderAgreementHtml(d);
  assert.equal((html.match(/<initials-field /g) ?? []).length, 4);
  assert.ok(html.includes("(includes all sales tax and fees)"));
  assert.deepEqual(sendProblems(d), []);
  assert.deepEqual(d.template, repairSnap, "the agreement keeps the template it came from");
});

test("templates: optional clauses on by default, and required ones can't be switched off", () => {
  const t: TemplateSnapshot = {
    ...BUILTIN_STANDARD,
    id: "44444444-4444-4444-8444-444444444444",
    version_no: 1,
    name: "Stamped",
    clauses: BUILTIN_STANDARD.clauses.map((c) => (c.id === "clause.insurance" ? { ...c, on_by_default: true } : c)),
  };
  const d = draftAgreement(input({ template: t, optionalClauses: undefined }));
  assert.ok(d.blocks.some((b) => b.id === "clause.insurance"));
  assert.ok(!d.blocks.some((b) => b.id === "clause.liability"));
  assert.equal(toggleClause(d, "clause.warranty", false), d);
});

test("templates: a clause that only exists in the template round-trips; a forged one is refused", () => {
  const t: TemplateSnapshot = {
    ...BUILTIN_STANDARD,
    id: "55555555-5555-4555-8555-555555555555",
    version_no: 3,
    name: "Commercial",
    clauses: [
      { id: "clause.site_access", kind: "clause", title: "Site Access", text: "Gate open 7-5.", text_includes_tax: null, optional: false, on_by_default: false },
      ...BUILTIN_STANDARD.clauses,
    ],
  };
  const d = draftAgreement(input({ template: t }));
  assert.deepEqual(parseBody(JSON.parse(JSON.stringify(d))), d);
  const forged = JSON.parse(JSON.stringify(d));
  forged.blocks.push({ id: "clause.not_in_template", kind: "clause", title: "X", text: "y", origin: "template", base: "y" });
  assert.equal(parseBody(forged), null);
  assert.ok(renderAgreementHtml(d).includes("<h2>Site Access</h2>"));
});

test("templates: an agreement saved before templates existed reads as the built-in standard", () => {
  const d = draftAgreement(input());
  const legacy = JSON.parse(JSON.stringify(d));
  delete legacy.template;
  assert.deepEqual(parseBody(legacy)?.template, BUILTIN_STANDARD);
});

test("templates: bad template bodies are refused with a reason", () => {
  const ok = { tax_mode: "plus_tax", clauses: BUILTIN_STANDARD.clauses };
  const bad = (over: Record<string, unknown>) => parseTemplateBody({ ...ok, ...over });
  assert.equal(bad({ tax_mode: "x" }).ok, false);
  assert.equal(bad({ clauses: [] }).ok, false);
  assert.equal(bad({ clauses: BUILTIN_STANDARD.clauses.filter((c) => c.id !== "clause.authorization") }).ok, false);
  assert.equal(bad({ clauses: [...BUILTIN_STANDARD.clauses, BUILTIN_STANDARD.clauses[0]] }).ok, false, "repeated id");
  assert.equal(bad({ clauses: [{ ...BUILTIN_STANDARD.clauses[0], id: "clause.Bad Id" }, ...BUILTIN_STANDARD.clauses.slice(1)] }).ok, false);
  assert.equal(bad({ clauses: BUILTIN_STANDARD.clauses.map((c) => (c.id === "clause.authorization" ? { ...c, optional: true } : c)) }).ok, false);
  assert.equal(parseSnapshot({ ...ok, id: "nope", version_no: 1, name: "x" }), null);
  assert.equal(parseSnapshot({ ...ok, id: null, version_no: 2, name: "x" }), null, "id and version go together");
});

test("templates: the version diff says when the template changed", () => {
  const a = draftAgreement(input());
  const b = draftAgreement(input({ template: repairSnap, taxMode: undefined, optionalClauses: undefined }));
  const t = diffVersions(a, b).find((c) => c.kind === "value" && c.key === "template");
  assert.ok(t && t.kind === "value" && t.after === "Repair Agreement (v2)");
});
