// The contract between the quote forms and /api/quote, in one place.
//
// The rule it exists to enforce: a customer sees "You're all set!" ONLY when
// the server has written their request to the database and says so, with the
// id of the row it wrote. Not when the response is 200, not when it says
// `ok: true`, not when nothing went wrong that we noticed. Every one of those
// weaker checks has, at some point, shown a success screen for a request that
// was never saved:
//
//   - the spam trap "succeeded" in the browser without sending anything
//   - the server answered ok+demo when it had no database keys
//   - the server answered ok for a trapped request it then threw away
//
// So the success condition is positive and specific (saved === true plus a
// real row id), and anything else - a new server path, a proxy's error page,
// a half-read body - falls through to the error screen with our phone number.
// Failing closed costs a phone call. Failing open cost us customers.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What /api/quote returns when, and only when, the lead is in the database. */
export type ConfirmedSave = { ok: true; saved: true; lead_id: string; duplicate?: boolean };

export function isConfirmedSave(status: number, body: unknown): body is ConfirmedSave {
  if (status !== 200 && status !== 201) return false;
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.ok === true && b.saved === true && typeof b.lead_id === "string" && UUID_RE.test(b.lead_id);
}

/** A short reference shown on the success screen and in the owner's alert. */
export function leadReference(leadId: string): string {
  return leadId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * One id per filled-in form, sent with every attempt to submit it. The server
 * stores it on the row under a unique index, so a retry after a timeout or a
 * double tap finds the lead it already saved instead of making a second one.
 */
export function newSubmissionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Old browsers without randomUUID: still unique enough per form.
    const hex = (n: number) =>
      Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  }
}
