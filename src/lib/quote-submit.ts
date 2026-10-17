// Contract between the quote forms and /api/quote. The customer sees "You're all set!" ONLY when the server
// says saved === true with a real row id; not on 200 or `ok: true` alone (spam traps, keyless demo mode and
// discarded requests have all returned those). Anything else shows the error screen with our number.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What /api/quote returns when, and only when, the lead is in the database.
 * `visit_booked` is false for an in-person request saved without a time (skipped, or the slot went);
 * the lead is still saved and the success screen says we'll call.
 */
export type ConfirmedSave = { ok: true; saved: true; lead_id: string; duplicate?: boolean; visit_booked?: boolean };

export function isConfirmedSave(status: number, body: unknown): body is ConfirmedSave {
  if (status !== 200 && status !== 201) return false;
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.ok === true && b.saved === true && typeof b.lead_id === "string" && UUID_RE.test(b.lead_id);
}

/** Shown on the success screen and in the owner's alert. */
export function leadReference(leadId: string): string {
  return leadId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** One id per filled-in form, stored under a unique index so a retry or double tap finds the existing lead. */
export function newSubmissionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for browsers without randomUUID.
    const hex = (n: number) =>
      Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  }
}

/** 10 digits, or 11 starting with 1. The one thing a lead can't be saved without. */
export function isValidUsPhone(phone: string): boolean {
  const d = (phone || "").replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}

/**
 * Last resort when the server can't take the request: an sms: link to us prefilled with what they typed.
 * Kept short; it's a text.
 */
export function smsFallbackHref(
  toDigits: string,
  f: { name: string; phone: string; address: string; service: string; mode: string; when: string },
): string {
  const lines = [
    "Quote request from the website:",
    f.name && `Name: ${f.name}`,
    f.phone && `Phone: ${f.phone}`,
    f.address && `Address: ${f.address}`,
    f.service && `Service: ${f.service}`,
    f.mode && `Type: ${f.mode === "online" ? "online quote" : "in-person visit"}`,
    f.when && `Visit: ${f.when}`,
  ].filter(Boolean);
  // "?&body=" is the form both iOS and Android read.
  return `sms:+1${toDigits.replace(/\D/g, "").slice(-10)}?&body=${encodeURIComponent(lines.join("\n"))}`;
}
