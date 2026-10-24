"use server";

import { getSession } from "@/lib/crm/auth";
import {
  TRANSLATE_MAX_CHARS,
  TRANSLATE_MAX_TEXTS,
  TRANSLATE_UNAVAILABLE,
  translateToEnglish,
  type TranslateResult,
} from "@/lib/crm/translate";
import { isTranslateField, type TranslateItem } from "@/lib/crm/translate-fields";
import { rateLimit } from "@/lib/rate-limit";

/**
 * A Spanish-mode writer's customer wording, in English for them to review. Only for staff with Spanish
 * on: nobody writing in English should spend on this. Rate limited per person on top of the API key's
 * monthly cap, so a stuck button can't run the bill up.
 */
export async function translateForCustomer(items: TranslateItem[]): Promise<TranslateResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  if (session.staff.locale !== "es") return { ok: false, error: TRANSLATE_UNAVAILABLE };

  // Only the known fields: the field names are part of the instructions the model follows.
  const clean: TranslateItem[] = Array.isArray(items)
    ? items.filter((i) => isTranslateField(i?.field)).map((i) => ({ field: i.field, text: String(i.text ?? "") }))
    : [];
  if (clean.length !== (Array.isArray(items) ? items.length : 0)) return { ok: false, error: TRANSLATE_UNAVAILABLE };
  if (clean.length > TRANSLATE_MAX_TEXTS || clean.reduce((n, i) => n + i.text.length, 0) > TRANSLATE_MAX_CHARS) {
    return { ok: false, error: "That's too much text to translate at once. Shorten it, or split it up." };
  }
  if (await rateLimit(`translate:${session.staff.id}`, 40, 60 * 60 * 1000)) {
    return { ok: false, error: TRANSLATE_UNAVAILABLE };
  }
  return translateToEnglish(clean);
}
