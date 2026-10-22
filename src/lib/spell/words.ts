// Finding misspelled words in what the crew type into a quote. Pure, so it
// runs (and is tested) without a browser; the dictionary itself is loaded by
// ./speller.ts and passed in as `isWord`.

// Trade words a general English dictionary doesn't know, gathered from the
// words our own quotes actually use. Lower case; matched case-insensitively.
export const TRADE_WORDS = [
  "rebar", "rebars", "subgrade", "subgrades", "subbase", "paver", "pavers", "geotextile", "geotextiles",
  "screeded", "screeding", "keyway", "keyways", "remesh", "formwork", "resurfacer", "backfill",
  "backfilled", "backfilling", "hardscape", "hardscapes", "hardscaping", "walkthrough", "walkthroughs",
  "rolloff", "sawcut", "sawcuts", "sawcutting", "fibermesh", "wythe", "quikrete", "sakrete", "cmu",
  "hoa", "hvac", "llc", "nds", "psi", "sq", "ft", "lf", "cy", "yd", "yds", "mil", "pre", "precast",
  "regrade", "regrading", "downspout", "downspouts", "dumpster", "bobcat", "skidsteer", "stoop",
  "flatwork", "inhibitive", "broomed", "troweled", "troweling", "underlayment", "doweled", "doweling", "edger", "edgers",
] as const;

// Real words that are almost always a slip in a quote, underlined anyway.
// "tare out" turns up again and again for "tear out".
export const CONFUSABLES = new Set(["tare", "tareing", "boarder"]);

export type Misspelling = {
  start: number;
  end: number;
  word: string;
};

// A word: letters with inner apostrophes or hyphens ("don't", "tie-in").
// Anything touching a digit ("4x8", "6in", "#4") is a measurement, not a word.
const WORD = /[A-Za-zÀ-ɏ]+(?:['’\-][A-Za-zÀ-ɏ]+)*/g;

// Spans to leave alone entirely: links and emails.
const SKIP_SPANS = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gi;

export function findMisspellings(text: string, isWord: (w: string) => boolean): Misspelling[] {
  const skip: [number, number][] = [];
  for (const m of text.matchAll(SKIP_SPANS)) skip.push([m.index, m.index + m[0].length]);

  const out: Misspelling[] = [];
  for (const m of text.matchAll(WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    if (skip.some(([a, b]) => start < b && end > a)) continue;
    // Part of something with digits in it: "4x8", "2nd", "#4rebar".
    if (/\d/.test(text[start - 1] ?? "") || /\d/.test(text[end] ?? "")) continue;

    const word = m[0].replace(/’/g, "'");
    // ALL CAPS is a heading or an abbreviation (TOTAL PRICE, HOA, NDS).
    if (word.length > 1 && word === word.toUpperCase()) continue;

    const lower = word.toLowerCase();
    if (CONFUSABLES.has(lower)) {
      out.push({ start, end, word: m[0] });
      continue;
    }
    // "tie-in", "pre-pour": fine if the whole thing is a word, or every part is.
    const ok = known(word, isWord) || (word.includes("-") && word.split("-").every((p) => known(p, isWord)));
    if (!ok) out.push({ start, end, word: m[0] });
  }
  return out;
}

const TRADE = new Set<string>(TRADE_WORDS);

function known(word: string, isWord: (w: string) => boolean): boolean {
  if (word.length < 2) return true;
  const lower = word.toLowerCase();
  if (TRADE.has(lower)) return true;
  // The dictionary is case-aware: "raleigh" is wrong but "Raleigh" is right,
  // and a capitalised first word of a sentence should pass as its lower case.
  return isWord(word) || isWord(lower) || isWord(lower[0].toUpperCase() + lower.slice(1));
}
