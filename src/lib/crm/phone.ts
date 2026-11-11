// Phone numbers, and the customer's second number. Pure, so it's unit-tested and safe to import anywhere.

export function toE164(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (trimmed.startsWith("+")) {
    const cleaned = "+" + trimmed.slice(1).replace(/\D/g, "");
    return cleaned.length >= 11 && cleaned.length <= 16 ? cleaned : null;
  }
  const d = trimmed.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

// ── The second number ───────────────────────────────────────────────────────
// A partner or parent the office adds by hand. Every text to the customer about the job goes there too, word for
// word, under the same rules (quiet hours, spacing, cancelled when the job is Lost), logged as its own row.

// Customer texts that are NOT copied: the agreement signing link signs as the customer, so it goes to them alone.
export const CC_SKIPPED_KINDS: ReadonlySet<string> = new Set(["agreement_sign_customer"]);

/**
 * Where a copy of this text goes, or null for none. `customerTo` and `cc` are the raw stored numbers. Only a
 * customer text on a job is copied; `noCc` is for a resend of one row (Retry), which must not copy again. A copy to
 * the customer's own number would be a second identical text, so none.
 */
export function ccCopyTo(input: {
  role?: string | null;
  kind?: string | null;
  quoteId?: string | null;
  noCc?: boolean;
  customerTo: string;
  cc: string | null | undefined;
}): string | null {
  if (input.role !== "customer" || !input.quoteId || input.noCc) return null;
  if (input.kind && CC_SKIPPED_KINDS.has(input.kind)) return null;
  const cc = input.cc ? toE164(input.cc) : null;
  if (!cc) return null;
  return cc === toE164(input.customerTo) ? null : cc;
}

/**
 * What the office typed for the second number: blank clears it, otherwise a US or + number stored in E.164.
 * Refused when it's the customer's own number (they'd get every text twice).
 */
export function parseCcPhone(raw: string, customerPhone: string): { value: string | null } | { error: string } {
  const typed = raw.trim();
  if (!typed) return { value: null };
  const cc = toE164(typed);
  if (!cc) return { error: "Enter the second number as a 10-digit phone number, or leave it blank." };
  if (cc === toE164(customerPhone)) return { error: "That's already the customer's number. Enter a different one, or leave it blank." };
  return { value: cc };
}
