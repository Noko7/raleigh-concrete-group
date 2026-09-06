// Server-only Stripe client. Do NOT import from client components: this module
// references the secret key.
//
// No SDK, matching how rest.ts talks to Supabase. Stripe's API is form-encoded
// HTTP with nested keys written as `a[b]=c`, which is a dozen lines to produce,
// and the alternative is a dependency in a repo that has deliberately avoided
// them everywhere else.
//
// Two things here are load-bearing and worth reading before changing:
//
//   1. `stripeAccount` on a request is what makes a charge a DIRECT charge. It
//      sends `Stripe-Account: acct_…`, which puts the payment on the
//      contractor's account rather than the platform's - their balance, their
//      card fees, their 1099-K. Leave it off and the money lands here instead,
//      which is the exact outcome this whole design exists to avoid.
//
//   2. `verifyWebhook` is the only thing standing between a stranger and
//      "this job is paid". It must stay a constant-time compare with a
//      timestamp window.
import { createHmac, timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("@/lib/crm/stripe is server-only and must not be imported from client code.");
}

const SECRET = process.env.STRIPE_PRIV_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SEC || "";

// Pinned rather than floating. Stripe changes shapes between versions, and a
// payments integration silently re-shaped by an upstream release is how a
// webhook stops finding the field it reads. This is the version the Stripe
// account is configured for.
const API_VERSION = "2026-07-29.dahlia";
const API = "https://api.stripe.com/v1";

export const STRIPE_READY = Boolean(SECRET);

/** An account id we'd accept from a form or a webhook. */
export const ACCOUNT_RE = /^acct_[A-Za-z0-9]{8,}$/;

export type StripeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status: number };

// Stripe wants application/x-www-form-urlencoded with nested keys spelled
// `payment_intent_data[application_fee_amount]`. Arrays are indexed:
// `line_items[0][price_data][currency]`.
//
// undefined and null are dropped rather than sent as the strings "undefined"
// and "null" - which Stripe would cheerfully store, and which is how an
// optional field ends up on a customer's receipt.
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
  /** Act as this connected account - what makes a charge a direct charge. */
  stripeAccount?: string | null;
  /**
   * Safe to retry. Stripe treats a repeated key as the same request and
   * returns the original result instead of charging a customer twice, which
   * matters on every write that moves money.
   */
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
    // A network failure, not a refusal. Told apart from a 4xx on purpose: this
    // one is worth retrying and a declined card is not.
    return { ok: false, error: "Couldn't reach Stripe. Please try again.", status: 0 };
  }

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string; type?: string };
  } & T;

  if (!res.ok) {
    // Stripe's own message is the useful one ("No such account", "Your card was
    // declined") and it is written for a human. Passed through for staff
    // screens; customer-facing callers substitute their own wording.
    return {
      ok: false,
      error: json.error?.message || `Stripe returned ${res.status}.`,
      code: json.error?.code || json.error?.type,
      status: res.status,
    };
  }
  return { ok: true, data: json as T };
}

// ── Accounts ────────────────────────────────────────────────────────────────

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

/**
 * Read a connected account.
 *
 * Used when the office pastes an acct_ id in, and again whenever the cached
 * flags need refreshing. The three booleans are the only things the app acts
 * on: `charges_enabled` decides whether a payment link can be sent at all.
 */
export async function getAccount(accountId: string): Promise<StripeResult<StripeAccount>> {
  if (!ACCOUNT_RE.test(accountId)) {
    return { ok: false, error: "That doesn't look like a Stripe account ID.", status: 0 };
  }
  return call<StripeAccount>(`accounts/${accountId}`);
}

// ── Checkout ────────────────────────────────────────────────────────────────

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
 * A hosted payment page for one payment on a job.
 *
 * Created ON the contractor's account (`stripeAccount`), which is what makes
 * this a direct charge: the money lands in their balance and only
 * `applicationFeeCents` is moved to the platform.
 *
 * Payment methods are deliberately NOT listed. Leaving `payment_method_types`
 * off lets Stripe show whatever that contractor's account actually has turned
 * on - card today, and Affirm or anything else the day it is approved for them,
 * with no code change here. Hard-coding the list would mean a contractor could
 * be approved for financing and their customers would never be offered it.
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

  // Stripe rejects a fee equal to or larger than the charge. Caught here as
  // well as in the fee engine, because the failure mode is a customer sitting
  // on a broken checkout page and no way to tell them why.
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
      // Omitted entirely when zero: Stripe requires a positive value, so the
      // final payment on a job whose fee was already taken must not send the
      // parameter at all rather than sending 0.
      payment_intent_data: applicationFeeCents > 0
        ? { application_fee_amount: applicationFeeCents, metadata }
        : { metadata },
      customer_email: customerEmail || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      // On the session as well as the PaymentIntent: the webhook reads the
      // session, and a job id that only exists on the intent would mean a
      // second API call on every delivery to find out which job was paid.
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
 * Kill a session nobody can use.
 *
 * Called when we created a session and then failed to write our own record of
 * it. An abandoned session is otherwise payable for 24 hours, and a customer
 * paying one we have no row for is money that arrives with no job attached to
 * it - the one outcome the webhook can only log and not fix.
 */
export async function expireCheckoutSession(
  sessionId: string,
  stripeAccount: string,
): Promise<void> {
  await call(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, { stripeAccount }).catch(
    () => {},
  );
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/**
 * Refund a direct charge, and give back the office's cut with it.
 *
 * `refund_application_fee` is not the default and has to be asked for. Without
 * it Stripe returns the customer's money out of the CONTRACTOR's balance while
 * the platform quietly keeps its fee - so a refunded job would cost the crew
 * the full amount plus the office's percentage.
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

// ── Webhook verification ────────────────────────────────────────────────────

export type StripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  created: number;
  /** Present only on connected-account events - the acct_ the event belongs to. */
  account?: string;
  data: { object: Record<string, unknown> };
};

// How far out of step with Stripe a delivery may be. Five minutes is Stripe's
// own recommendation: long enough to survive ordinary clock drift and a slow
// cold start, short enough that a captured request can't be replayed later.
const TOLERANCE_SECONDS = 300;

/**
 * Verify a webhook came from Stripe, and hasn't been replayed.
 *
 * The signed payload is `${timestamp}.${rawBody}` - the RAW body, byte for
 * byte. Parsing the JSON first and re-serialising it changes key order and
 * whitespace and the signature will never match again, which is the classic
 * way this fails.
 *
 * A failure here returns null and the caller answers 400. It must never fall
 * through to "probably fine": this signature is the only thing distinguishing
 * Stripe from anyone on the internet who has guessed the URL, and what is on
 * the other side of it is marking jobs paid.
 */
export function verifyWebhook(rawBody: string, signatureHeader: string | null): StripeEvent | null {
  if (!WEBHOOK_SECRET || !signatureHeader) return null;

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") timestamp = v ?? "";
    // v1 only. v0 is Stripe's older test-mode scheme and accepting it would
    // widen what we trust for no benefit.
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

  // Stripe can send several signatures during a secret rotation, so any match
  // is a pass. Compared in constant time - a plain === leaks how much of the
  // signature was right through how long it took to say no.
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

// ── Diagnostics ─────────────────────────────────────────────────────────────
// What the Settings screen shows an owner when something isn't working. Mirrors
// smsDiagnostics in notify.ts, and for the same reason: "it doesn't work" is
// not a fault report anyone can act on.
export function stripeDiagnostics(): { ready: boolean; missing: string[]; apiVersion: string } {
  const missing: string[] = [];
  if (!SECRET) missing.push("STRIPE_PRIV_KEY");
  if (!WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SEC");
  return { ready: missing.length === 0, missing, apiVersion: API_VERSION };
}
