"use client";

import { rankSuggestions } from "./words";

// The dictionary behind the quote fields' spell check. Loaded once per page, on
// first use, from /spell (en_US Hunspell from SCOWL, via the dictionary-en
// package, 4.0.0): about 550KB, cached for a year since the filename carries
// the version. The phone's own checker can't be relied on (iOS only underlines
// while typing, and only with Check Spelling on), so this one runs everywhere.

type NSpell = { correct(word: string): boolean; suggest(word: string): string[]; add(word: string): unknown };

const AFF = "/spell/en-us-4.0.0.aff";
const DIC = "/spell/en-us-4.0.0.dic";
// Words someone tapped "Add" on, on this device.
const OWN_WORDS_KEY = "rcg-spell-own-words";

export type Speller = {
  isWord(word: string): boolean;
  suggest(word: string): string[];
  addOwn(word: string): void;
};

let loading: Promise<Speller | null> | null = null;
const listeners = new Set<() => void>();

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
      for (const w of ownWords()) sp.add(w);
      const suggestions = new Map<string, string[]>();
      return {
        isWord: (w) => sp.correct(w),
        // Slow for long nonsense words; asked only for the few on screen, and remembered.
        suggest: (w) => {
          let s = suggestions.get(w);
          if (!s) suggestions.set(w, (s = rankSuggestions(w, sp.suggest(w)).slice(0, 3)));
          return s;
        },
        addOwn: (w) => {
          sp.add(w);
          saveOwnWord(w);
          // Every field re-checks, so the word clears everywhere at once.
          for (const fn of listeners) fn();
        },
      };
    } catch {
      loading = null; // Try again on the next field that asks.
      return null;
    }
  })();
  return loading;
}

/** Called when the word list changes (someone added a word). Returns the unsubscribe. */
export function onWordsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ownWords(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OWN_WORDS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((w): w is string => typeof w === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

function saveOwnWord(word: string) {
  try {
    const words = ownWords();
    if (!words.includes(word)) localStorage.setItem(OWN_WORDS_KEY, JSON.stringify([...words, word].slice(-500)));
  } catch {
    // Private mode or storage off: the word still counts until the page closes.
  }
}
