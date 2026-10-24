// What each string sent for translation is, so the model formats every kind the same way every time.
// Client-safe: the forms tag their strings with these, and the server only accepts these.
export const TRANSLATE_FIELDS = [
  "Quote section: Scope",
  "Quote section: Permits",
  "Quote section: Demolition and prep",
  "Quote section: Pour and finish",
  "Quote section: Clean up",
  "Quote summary",
  "Line item title",
  "Line item description",
  "Option title",
  "Option description",
  "Change order note",
] as const;

export type TranslateField = (typeof TRANSLATE_FIELDS)[number];
export type TranslateItem = { field: TranslateField; text: string };

export function isTranslateField(v: unknown): v is TranslateField {
  return typeof v === "string" && (TRANSLATE_FIELDS as readonly string[]).includes(v);
}
