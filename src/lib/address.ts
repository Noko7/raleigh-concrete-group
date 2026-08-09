// One definition of "a real, complete street address", shared by the quote form
// and the API that receives it. The browser check is there to help the customer
// fix it while they're typing; the server check is the one that actually holds,
// since anything client-side can be edited.
//
// A quote needs an address we can find on a map: a crew has to drive to it and
// we price driveways off satellite imagery. "Raleigh" or "my house on Main St"
// costs a phone call to chase down, which is the thing this prevents.

// Two-letter USPS state codes. Matched as whole words, case-insensitive.
const STATE_RE =
  /\b(A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/gi;

/**
 * True when `raw` looks like "123 Main St, Raleigh, NC" (ZIP optional).
 *
 * Requires, in order: a house number, a street, a comma, a city, and a state
 * code. Deliberately tolerant about the comma before the state and about the
 * ZIP, because people type "Raleigh NC 27601" and "Raleigh, NC, 27601" about
 * equally often, and both are perfectly findable.
 */
export function isFullAddress(raw: string): boolean {
  const a = (raw || "").trim().replace(/\s+/g, " ");
  if (a.length < 12) return false;
  // Must start with a house number ("123", "123B").
  if (!/^\d+[A-Za-z]?\s+\S/.test(a)) return false;

  // Take the LAST state-looking token: a street named "Ok Ave" or "In Ln" would
  // otherwise match as Oklahoma/Indiana and swallow the city check.
  const matches = [...a.matchAll(STATE_RE)];
  const state = matches[matches.length - 1];
  if (!state || state.index === undefined) return false;

  // Anything after the state may only be a ZIP.
  const tail = a.slice(state.index + state[0].length).trim().replace(/^,/, "").trim();
  if (tail && !/^\d{5}(-\d{4})?$/.test(tail)) return false;

  // Everything before the state has to be "street, city" - two non-empty parts.
  const head = a.slice(0, state.index).trim().replace(/,$/, "").trim();
  const parts = head.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}

// What to tell someone whose address isn't complete yet. One sentence, with an
// example, because "invalid address" doesn't tell them what to change.
export const ADDRESS_HINT = "Enter the full address, including city and state. Example: 123 Main St, Raleigh, NC";
