// Client side of translateForCustomer: only sends strings it hasn't seen, so going back to tweak one
// line and reviewing again pays for that line alone. Text that needs no translating never leaves the page.
import { translateForCustomer } from "@/app/crm/translate-actions";
import { NOT_APPLICABLE } from "@/components/quote-form-parts";
import { BREAKDOWN_PRESETS } from "@/app/crm/quotes/[id]/option-builder";
import type { TranslateItem } from "@/lib/crm/translate-fields";

// Keyed by field and text: the same words can read differently as a title and as a sentence.
const cache = new Map<string, string>();
const keyOf = (i: TranslateItem) => `${i.field}\u0000${i.text}`;
// Stored text has no field attached; it's English whatever field it's in.
const knownEnglish = new Set<string>();

// Already the customer's English: the "Not applicable" button, the preset line names, bare numbers.
const KEEP = new Set<string>([NOT_APPLICABLE, ...BREAKDOWN_PRESETS]);
const keep = (s: string) => s.trim() === "" || KEEP.has(s.trim()) || !/\p{L}/u.test(s);

export type EnglishResult = { ok: true; texts: string[] } | { ok: false; error: string };

const skip = (i: TranslateItem) => keep(i.text) || knownEnglish.has(i.text);

/** The items' text in English, in order. */
export async function toCustomerEnglish(items: TranslateItem[]): Promise<EnglishResult> {
  const seen = new Set<string>();
  const todo = items.filter((i) => {
    const k = keyOf(i);
    if (skip(i) || cache.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (todo.length > 0) {
    const res = await translateForCustomer(todo).catch(() => null);
    if (!res) return { ok: false, error: "Translation isn't available right now. Write it in English, or try again in a few minutes." };
    if (!res.ok) return res;
    todo.forEach((i, n) => cache.set(keyOf(i), res.texts[n]));
  }
  return { ok: true, texts: items.map((i) => (skip(i) ? i.text : (cache.get(keyOf(i)) ?? i.text))) };
}

/** Text already stored on the quote is the customer's English: reviewing it again costs nothing. */
export function markEnglish(texts: (string | null | undefined)[]): void {
  for (const s of texts) if (s && !keep(s)) knownEnglish.add(s);
}
