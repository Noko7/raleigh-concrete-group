// "A real, complete street address", shared by the quote form (helps while typing) and the API (the check
// that holds). A crew drives to it and driveways are priced off satellite imagery.

// USPS state codes, matched as whole words, case-insensitive.
const STATE_RE =
  /\b(A[LKZR]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/gi;

/** House number, street, comma, city, state code. Tolerant about the comma before the state and the ZIP. */
export function isFullAddress(raw: string): boolean {
  const a = (raw || "").trim().replace(/\s+/g, " ");
  if (a.length < 12) return false;
  if (!/^\d+[A-Za-z]?\s+\S/.test(a)) return false;

  // LAST state-looking token: "Ok Ave" or "In Ln" would otherwise match Oklahoma/Indiana.
  const matches = [...a.matchAll(STATE_RE)];
  const state = matches[matches.length - 1];
  if (!state || state.index === undefined) return false;

  // Only a ZIP may follow the state.
  const tail = a.slice(state.index + state[0].length).trim().replace(/^,/, "").trim();
  if (tail && !/^\d{5}(-\d{4})?$/.test(tail)) return false;

  // "street, city": two non-empty parts.
  const head = a.slice(0, state.index).trim().replace(/,$/, "").trim();
  const parts = head.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((p) => p.length >= 2);
}

export const ADDRESS_HINT = "Enter the full address, including city and state. Example: 123 Main St, Raleigh, NC";
