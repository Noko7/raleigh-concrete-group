"use client";

// The dictionary behind the quote fields' spell check. Loaded once per page, on
// first use, from /spell (en_US Hunspell from SCOWL, via the dictionary-en
// package, 4.0.0): about 550KB, cached for a year since the filename carries
// the version. The phone's own checker can't be relied on (iOS only underlines
// while typing, and only with Check Spelling on), so this one runs everywhere.

type NSpell = { correct(word: string): boolean };

const AFF = "/spell/en-us-4.0.0.aff";
const DIC = "/spell/en-us-4.0.0.dic";
export type Speller = { isWord(word: string): boolean };

let loading: Promise<Speller | null> | null = null;

/** Null when the dictionary can't be fetched: the fields then just work without it. */
export function loadSpeller(): Promise<Speller | null> {
  loading ??= (async () => {
    try {
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import("nspell"),
        fetch(AFF).then((r) => (r.ok ? r.text() : Promise.reject(r.status))),
        fetch(DIC).then((r) => (r.ok ? r.text() : Promise.reject(r.status))),
      ]);
      const sp = nspell(aff, dic) as NSpell;
      return { isWord: (w) => sp.correct(w) };
    } catch {
      loading = null; // Try again on the next field that asks.
      return null;
    }
  })();
  return loading;
}
