// The preview card on a crew job link: only initials and the job type, escaped, and a steady colour per job.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { colourFor, initialsOf, JOB_TOKEN, previewHtml, previewTitle, serviceFontSize, serviceLabel } from "./link-preview.ts";

test("initials: first and last word, letters only", () => {
  assert.equal(initialsOf("Martha Flanagan"), "MF");
  assert.equal(initialsOf("salil pant"), "SP");
  assert.equal(initialsOf("Cher"), "C");
  assert.equal(initialsOf("Mary Ann de la Cruz"), "MC");
  assert.equal(initialsOf("Ruth d'Entremont"), "RD");
  assert.equal(initialsOf("  "), "?");
  assert.equal(initialsOf(null), "?");
  assert.equal(initialsOf("José Ñúñez"), "JÑ");
  assert.equal(initialsOf("<script> 123"), "S");
});

test("job type label", () => {
  assert.equal(serviceLabel("Front/Back Porch"), "Front/Back Porch");
  assert.equal(serviceLabel(""), "Job");
  assert.equal(serviceLabel(null), "Job");
  assert.equal(previewTitle("Tushar Rane", "Driveway"), "TR · Driveway");
});

test("tokens and colours", () => {
  assert.ok(JOB_TOKEN.test("38a987d1df8d467abc17207d10db2b33"));
  assert.equal(JOB_TOKEN.test("38a987d1df8d467abc17207d10db2b3"), false);
  assert.equal(JOB_TOKEN.test("../../etc/passwd"), false);
  assert.equal(colourFor("abc"), colourFor("abc"));
  assert.match(colourFor("38a987d1df8d467abc17207d10db2b33"), /^#[0-9a-f]{6}$/);
});

test("the page carries only the title, escaped, and sends people to sign in", () => {
  const html = previewHtml({ title: 'A"B <x> · Patio', imageUrl: "https://x/i?v=1&w=2", next: "/job/abc" });
  assert.match(html, /og:title" content="A&quot;B &lt;x&gt; · Patio"/);
  assert.match(html, /og:image" content="https:\/\/x\/i\?v=1&amp;w=2"/);
  assert.match(html, /url=\/crm\/login\?next=%2Fjob%2Fabc/);
  assert.doesNotMatch(html, /<x>/);
});

test("long job types get smaller text", () => {
  assert.equal(serviceFontSize("Patio"), 96);
  assert.ok(serviceFontSize("Front/Back Porch") < serviceFontSize("Driveway"));
  assert.ok(serviceFontSize("Commercial Sidewalks & Walkways") <= 54);
});
