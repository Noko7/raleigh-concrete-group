// Spell check for the quote fields, against the same dictionary the browser
// loads. Words come from real quotes: what the crew misspell, and the trade
// terms a plain dictionary would wrongly flag.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import nspell from "nspell";

import { findMisspellings } from "./words.ts";

const dir = new URL("../../../public/spell/", import.meta.url);
const sp = nspell(readFileSync(new URL("en-us-4.0.0.aff", dir), "utf8"), readFileSync(new URL("en-us-4.0.0.dic", dir), "utf8"));
const flagged = (text: string) => findMisspellings(text, (w) => sp.correct(w)).map((m) => m.word);

test("catches the misspellings that show up in real quotes", () => {
  assert.deepEqual(flagged("Escavate 4in of soil and intall the forms, then demollish the old pad"), [
    "Escavate",
    "intall",
    "demollish",
  ]);
  // And the sound-alike ones from quotes already sent.
  assert.deepEqual(flagged("taken through the Bulder association, very prefecional"), ["Bulder", "prefecional"]);
  assert.deepEqual(flagged("the sosation is approved"), ["sosation"]);
});

test("leaves trade words, measurements, abbreviations and links alone", () => {
  const ok = [
    "Install #4 rebar on chairs over a compacted subgrade and geotextile fabric.",
    "Pavers set in polymeric sand; keyways at each pour break; formwork stripped.",
    "4x8 slab, 6in thick, 3,500 PSI, 600 sq ft, 2nd pour, 10-mil vapor barrier.",
    "HOA approval and NDS pop-up emitters. TOTAL PROJECT PRICE: $6,700.",
    "Backfill and dress the edges; final walkthrough with the customer.",
    "See https://raleighconcrete.net/q/abc or email office@example.com.",
    "Customer's driveway, don't pour until the tie-in and pre-pour inspection pass.",
    "Raleigh, Cary and Wake Forest. Tear out the old stoop.",
  ];
  for (const s of ok) assert.deepEqual(flagged(s), [], s);
});

test("underlines a real word that's almost always a slip", () => {
  assert.deepEqual(flagged("Will tare out old driveway"), ["tare"]);
  assert.deepEqual(flagged("Tare out the patio"), ["Tare"]);
});

test("a sent-quote term that isn't a mistake stays clean", () => {
  assert.deepEqual(flagged("rust-inhibitive primer"), []);
});

test("positions point at each word, so the underline lands under it", () => {
  const text = "Pour and finsh, then finsh the edges";
  assert.deepEqual(
    findMisspellings(text, (w) => sp.correct(w)).map((m) => [m.start, text.slice(m.start, m.end)]),
    [
      [9, "finsh"],
      [21, "finsh"],
    ],
  );
});
