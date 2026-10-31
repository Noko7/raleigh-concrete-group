// Server-only Stripe client (references the secret key). No SDK, matching rest.ts.
// Load-bearing:
//   1. `stripeAccount` sends `Stripe-Account: acct_…`, making a DIRECT charge on the contractor's account
//      (their balance, card fees, 1099-K). Without it the money lands on the platform.
//   2. `verifyWebhook` is all that stands between a stranger and "this job is paid": keep it a
//      constant-time compare with a timestamp window.
import { createHmac, timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/stripe is server-only and must not be imported from client code.");
}

const SECRET = process.env.STRIPE_PRIV_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SEC || "";

// Pinned: the Stripe account is configured for this version, and shape changes break webhook reads.
const API_VERSION = "2026-07-29.dahlia";
const API = "https://api.stripe.com/v1";

export const STRIPE_READY = Boolean(SECRET);
/**
 * Online card payments (customer checkout, deposit and pay links) are OFF unless the Vercel environment variable
 * ONLINE_CARD_PAYMENTS is "on". While off, customers pick how they'll pay the contractor directly, and
 * refunds of earlier card payments and the Stripe webhook keep working.
 */
export const ONLINE_CARD_PAYMENTS = process.env.ONLINE_CARD_PAYMENTS === "on";

export const ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,}$/;

export type StripeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status: number };

// Form-encoded with nested keys (`a[b]=c`, arrays indexed). undefined/null are dropped, not sent as
// the strings "undefined"/"null" (which Stripe would store).
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [rawKey, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const itemKey = `${key}[${i}]`;
        if (item !== null && typeof item === "object") {
          parts.push(formEncode(item as Record<string, unknown>, itemKey));
        } else if (item !== undefined && item !== null) {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(formEncode(value as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

type CallOptions = {
  /** Act as this connected account: what makes a charge a direct charge. */
  stripeAccount?: string | null;
  /** Stripe returns the original result for a repeated key instead of charging twice. */
  idempotencyKey?: string;
  method?: "GET" | "POST";
};

async function call<T>(
  path: string,
  body?: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<StripeResult<T>> {
  if (!SECRET) {
    return { ok: false, error: "Card payments aren't set up yet.", status: 0 };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${SECRET}`,
    "Stripe-Version": API_VERSION,
  };
  if (opts.stripeAccount) headers["Stripe-Account"] = opts.stripeAccount;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const method = opts.method ?? (body ? "POST" : "GET");
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";

  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method,
      cache: "no-store",
      headers,
      body: method === "POST" ? formEncode(body ?? {}) : undefined,
    });
  } catch {
    // Network failure (status 0), told apart from a 4xx: worth retrying, a declined card is not.
    return { ok: false, error: "Couldn't reach Stripe. Please try again.", status: 0 };
  }

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; type?: string };
  } & T;

  if (!res.ok) {
    // Stripe's message is human-readable; staff screens show it, customer-facing callers substitute their own.
    return {
      ok: false,
      error: json.error?.message || `Stripe returned ${res.status}.`,
      code: json.error?.code || json.error?.type,
      status: res.status,
    };
  }
  return { ok: true, data: json as T };
}

export type StripeAccount = {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  business_profile?: { name?: string | null } | null;
  email?: string | null;
  requirements?: {
    currently_due?: string[];
    disabled_reason?: string | null;
  } | null;
};

/** Only the three flags are acted on; `charges_enabled` decides whether a payment link can be sent. */
export async function getAccount(accountId: string): Promise<StripeResult<StripeAccount>> {
  if (!ACCOUNT_RE.test(accountId)) {
    return { ok: false, error: "That doesn't look like a Stripe account ID.", status: 0 };
  }
  return call<StripeAccount>(`accounts/${accountId}`);
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  payment_intent: string | null;
  amount_total: number | null;
  status: string;
  payment_status: string;
  metadata?: Record<string, string>;
};

/**
 * Created ON the contractor's account (direct charge): only `applicationFeeCents` goes to the platform.
 * `payment_method_types` is deliberately omitted so Stripe offers whatever the account has enabled
 * (e.g. Affirm once approved) with no code change.
 */
export async function createCheckoutSession(input: {
  stripeAccount: string;
  amountCents: number;
  applicationFeeCents: number;
  description: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}): Promise<StripeResult<CheckoutSession>> {
  const {
    stripeAccount,
    amountCents,
    applicationFeeCents,
    description,
    customerEmail,
    successUrl,
    cancelUrl,
    metadata,
    idempotencyKey,
  } = input;

  // Stripe rejects a fee >= the charge; checked here too so the customer isn't left on a broken checkout.
  if (applicationFeeCents >= amountCents) {
    return { ok: false, error: "The office's fee can't be the whole payment.", status: 0 };
  }

  return call<CheckoutSession>(
    "checkout/sessions",
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: description },
          },
        },
      ],
      // Omitted when zero: Stripe requires a positive value.
      payment_intent_data: applicationFeeCents > 0
        ? { application_fee_amount: applicationFeeCents, metadata }
        : { metadata },
      customer_email: customerEmail || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // On the session as well as the PaymentIntent: the webhook reads the session.
      metadata,
    },
    { stripeAccount, idempotencyKey },
  );
}

export async function getCheckoutSession(
  sessionId: string,
  stripeAccount: string,
): Promise<StripeResult<CheckoutSession>> {
  return call<CheckoutSession>(`checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, {
    stripeAccount,
  });
}

/**
 * For a session whose row failed to write. Otherwise it stays payable for 24h, and money paid on it has
 * no job attached.
 */
export async function expireCheckoutSession(
  sessionId: string,
  stripeAccount: string,
): Promise<void> {
  await call(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, { stripeAccount }).catch(
    () => {},
  );
}

/**
 * `refund_application_fee` must be requested: without it the refund comes out of the CONTRACTOR's balance
 * while the platform keeps its fee.
 */
export async function refundPayment(input: {
  paymentIntentId: string;
  stripeAccount: string;
  amountCents?: number;
  refundApplicationFee: boolean;
  idempotencyKey: string;
}): Promise<StripeResult<{ id: string; status: string; amount: number }>> {
  return call(
    "refunds",
    {
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      refund_application_fee: input.refundApplicationFee,
    },
    { stripeAccount: input.stripeAccount, idempotencyKey: input.idempotencyKey },
  );
}

export type StripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  /** Connected-account events only: the acct_ the event belongs to. */
  account?: string;
  data: { object: Record<string, unknown> };
};

// Stripe's recommended 5 minutes: survives clock drift, blocks later replay.
const TOLERANCE_SECONDS = 300;

/**
 * The signed payload is `${timestamp}.${rawBody}`: the RAW body byte for byte (re-serialised JSON never
 * matches). Returns null and the caller answers 400; never fall through, since this guards marking jobs paid.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null): StripeEvent | null {
  if (!WEBHOOK_SECRET || !signatureHeader) return null;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") timestamp = v ?? "";
    // v1 only; v0 is the older test-mode scheme.
    else if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return null;
  if (Math.abs(Date.now() / 1000 - sent) > TOLERANCE_SECONDS) return null;

  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  // Several signatures arrive during secret rotation, so any match passes. Constant-time: === leaks timing.
  const matched = signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
  if (!matched) return null;

  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    return null;
  }
}

// For the Settings screen; mirrors smsDiagnostics in notify.ts.
export function stripeDiagnostics(): { ready: boolean; missing: string[]; apiVersion: string } {
  const missing: string[] = [];
  if (!SECRET) missing.push("STRIPE_PRIV_KEY");
  if (!WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SEC");
  return { ready: missing.length === 0, missing, apiVersion: API_VERSION };
}
