// Spell check for the quote fields, against the same dictionary the browser
// loads. Words come from real quotes: what the crew misspell, and the trade
// terms a plain dictionary would wrongly flag.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import nspell from "nspell";

import { findMisspellings, matchCase, rankSuggestions, replaceAt } from "./words.ts";

const dir = new URL("../../../public/spell/", import.meta.url);
const sp = nspell(readFileSync(new URL("en-us-4.0.0.aff", dir), "utf8"), readFileSync(new URL("en-us-4.0.0.dic", dir), "utf8"));
const flagged = (text: string) => findMisspellings(text, (w) => sp.correct(w)).map((m) => m.word);

test("catches the misspellings that show up in real quotes", () => {
  assert.deepEqual(flagged("Escavate 4in of soil and intall the forms, then demollish the old pad"), [
    "Escavate",
    "intall",
    "demollish",
  ]);
  assert.deepEqual(sp.suggest("Escavate").slice(0, 1), ["Excavate"]);
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

test("flags a real word that's almost always a slip, with the word meant", () => {
  const [m] = findMisspellings("Will tare out old driveway", (w) => sp.correct(w));
  assert.equal(m.word, "tare");
  assert.equal(m.meant, "tear");
  assert.equal(findMisspellings("Tare out the patio", (w) => sp.correct(w))[0].meant, "Tear");
});

test("his past misspellings get the word he meant, not the dictionary's guess", () => {
  const meant = (text: string) => findMisspellings(text, (w) => sp.correct(w)).map((m) => m.meant);
  assert.deepEqual(meant("taken through the Bulder association"), ["Builder"]);
  assert.deepEqual(meant("the sosation is approved"), ["association"]);
  assert.deepEqual(meant("left clean and very prefecional"), ["professional"]);
  assert.deepEqual(meant("Escavate and intall"), ["Excavate", "install"]);
  // And a sent-quote term that isn't a mistake.
  assert.deepEqual(flagged("rust-inhibitive primer"), []);
});

test("positions point at the word, so a fix replaces exactly it", () => {
  const text = "Pour and finsh, then finsh the edges";
  const ms = findMisspellings(text, (w) => sp.correct(w));
  assert.deepEqual(
    ms.map((m) => text.slice(m.start, m.end)),
    ["finsh", "finsh"],
  );
  let fixed = text;
  for (const m of [...ms].reverse()) fixed = replaceAt(fixed, m.start, m.end, "finish");
  assert.equal(fixed, "Pour and finish, then finish the edges");
});

test("a suggestion that keeps every typed letter comes first", () => {
  const best = (w: string) => rankSuggestions(w, sp.suggest(w))[0];
  assert.equal(best("finsh"), "finish");
  assert.equal(best("Escavate"), "Excavate");
  assert.equal(best("intall"), "install");
  assert.equal(best("demollish"), "demolish");
  assert.equal(best("seperate"), "separate");
  assert.equal(best("replacment"), "replacement");
});

test("matchCase keeps how the word was typed", () => {
  assert.equal(matchCase("excavate", "Escavate"), "Excavate");
  assert.equal(matchCase("tear", "TARE"), "TEAR");
  assert.equal(matchCase("tear", "tare"), "tear");
});
