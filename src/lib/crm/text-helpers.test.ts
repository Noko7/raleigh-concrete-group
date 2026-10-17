// The small shared helpers for names and typed money: a customer's first name,
// a dollar amount as somebody typed it, and a dollar figure for a screen.
//
// Same setup as fees.test.ts: Node's own runner, no framework.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanAmount, dollarsOrZero, firstNameOf, parseDollars } from "./constants.ts";

test("firstNameOf: the first word of a name", () => {
  assert.equal(firstNameOf("Jane Smith", "x"), "Jane");
  assert.equal(firstNameOf("Jane   Mary  Smith", "x"), "Jane");
  assert.equal(firstNameOf("  Jane Smith  ", "x"), "Jane");
  assert.equal(firstNameOf("\tJane Smith\n", "x"), "Jane");
  assert.equal(firstNameOf("Jane", "x"), "Jane");
});

test("firstNameOf: each fallback when there is no name", () => {
  assert.equal(firstNameOf("", "there"), "there");
  assert.equal(firstNameOf("   ", "The customer"), "The customer");
  assert.equal(firstNameOf("", ""), "");
  // The common call passes the name itself back as the fallback.
  const blank = "  ";
  assert.equal(firstNameOf(blank, blank), blank);
});

test("cleanAmount: strips $, commas and whitespace", () => {
  assert.equal(cleanAmount("$1,200"), "1200");
  assert.equal(cleanAmount(" 12 "), "12");
  assert.equal(cleanAmount(""), "");
  assert.equal(cleanAmount(null), "");
  assert.equal(cleanAmount(undefined), "");
  assert.equal(cleanAmount("abc"), "abc");
});

test("parseDollars: the number, leaving validation to the caller", () => {
  assert.equal(parseDollars("$1,200"), 1200);
  assert.equal(parseDollars("1200.50"), 1200.5);
  assert.equal(parseDollars(" 12 "), 12);
  assert.equal(parseDollars(""), 0);
  assert.equal(parseDollars(null), 0);
  assert.ok(Number.isNaN(parseDollars("abc")));
  assert.equal(parseDollars("0"), 0);
  assert.equal(parseDollars("-$50"), -50);
  assert.equal(parseDollars("$-1,000.25"), -1000.25);
});

test("dollarsOrZero: dollars in, money out, $0 for nothing", () => {
  assert.equal(dollarsOrZero(1200), "$1,200");
  assert.equal(dollarsOrZero(8250.5), "$8,250.50");
  assert.equal(dollarsOrZero(0), "$0");
  assert.equal(dollarsOrZero(NaN), "$0");
});
