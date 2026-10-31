// The ways a customer can pay the contractor directly. Client-safe: the customer's quote page, the contractor
// settings and the agreement all read this one list. (Separate from fees.ts, which lists how a recorded payment
// came in, including Stripe card payments.)

export const PAYMENT_METHODS = ["zelle", "venmo", "check", "cash", "card"] as const;
export type PayMethod = (typeof PAYMENT_METHODS)[number];

/** When nobody has chosen (no contractor, or none set): the original four. Card is offered only when ticked. */
export const DEFAULT_PAYMENT_METHODS: PayMethod[] = ["zelle", "venmo", "check", "cash"];

export const METHOD_NAMES: Record<PayMethod, string> = { zelle: "Zelle", venmo: "Venmo", check: "Check", cash: "Cash", card: "Card" };

export function isPayMethod(v: unknown): v is PayMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** A contractor's accepted methods in the standard order; the default four when none are set. */
export function acceptedMethods(staffMethods: readonly string[] | null | undefined): PayMethod[] {
  const set = (staffMethods ?? DEFAULT_PAYMENT_METHODS).filter(isPayMethod);
  const ordered = PAYMENT_METHODS.filter((m) => set.includes(m));
  return ordered.length ? ordered : [...DEFAULT_PAYMENT_METHODS];
}

export const methodList = (ms: readonly PayMethod[]) => ms.map((m) => METHOD_NAMES[m]).join(", ");

/** The agreement's field name for a method's box, e.g. "Pays by Zelle" (agreement-doc renders it). */
export const payFieldName = (m: PayMethod) => `Pays by ${METHOD_NAMES[m]}`;

/**
 * The methods a customer ticked on the signed agreement, from DocuSeal's field values
 * ([{ field: "Pays by Zelle", value: true }, ...]), in the standard order.
 */
export function methodsFromSignedValues(values: unknown): PayMethod[] {
  if (!Array.isArray(values)) return [];
  const ticked = new Set<string>();
  for (const v of values) {
    const r = (v ?? {}) as { field?: unknown; value?: unknown };
    const on = r.value === true || (typeof r.value === "string" && /^(true|yes|1|checked|on)$/i.test(r.value.trim()));
    if (typeof r.field === "string" && on) ticked.add(r.field.trim());
  }
  return PAYMENT_METHODS.filter((m) => ticked.has(payFieldName(m)));
}
