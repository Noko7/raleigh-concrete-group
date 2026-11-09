// What never leaves the CRM through the connector, and how search text is made safe for a PostgREST filter.
// Pure, so it's unit-tested.

// Customer and crew links carry a capability token (/q/<token> opens the customer's quote, /pay/ takes a
// payment, /sign/ signs the agreement, /job/ is the crew page...). Texts the CRM sent contain them; Claude gets
// the text with the token masked. The path stays, so "they were sent the quote link" still reads.
const LINK_TOKEN = /(\/(?:q|job|pay|r|sign|confirm|confirm-job|join|change)\/)[A-Za-z0-9_-]{12,}/g;
// Media proxy signatures and any other long query secrets.
const QUERY_SECRET = /([?&](?:sig|token|t|key|signature|code)=)[^&\s"']+/gi;

export function redactLinks(text: string | null | undefined): string | null {
  if (text == null) return null;
  return text.replace(LINK_TOKEN, "$1[link]").replace(QUERY_SECRET, "$1[redacted]");
}

// Search text goes into a PostgREST or=() filter, whose own syntax uses , ( ) . : * and quotes. Only letters,
// digits and a few name/address characters survive, so a query can't add a filter of its own.
export function searchTerm(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} @'#+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length >= 2 ? cleaned : null;
}

// Digits typed as a phone number, for matching however the number was stored.
export function phoneDigits(term: string): string | null {
  const d = term.replace(/\D/g, "");
  return d.length >= 4 && d.length <= 11 && /^[\d\s()+-]+$/.test(term) ? d.slice(-10) : null;
}

export const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
