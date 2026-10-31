// Server-only: issuing, voiding and reading payment receipts (public.payment_receipts).
//
// A receipt is issued for every customer payment the moment it counts: a recorded cash/check/Zelle/Venmo
// payment when it is saved, a card payment when Stripe confirms it. Issuing takes a frozen copy of the
// payment, the job, the contractor who was paid and the job's balance, and the database numbers it
// (issue_payment_receipt(): 1, 2, 3... with no gaps) and keeps it forever. A receipt is never edited: a
// corrected payment voids its receipt and gets a new one that points back at it.
//
// Every step is best-effort for the CALLER: a payment that saved stays saved even if its receipt fails, and
// the failure is logged ([receipts]) so it can be issued again (ensureReceipt is idempotent).
import { jobLedger, paymentById } from "./payments";
import { addAdminEvent } from "./queries";
import { pgAdmin, pgUser } from "./rest";
import {
  buildReceiptSnapshot,
  methodLabel,
  payeeName,
  receiptNumberLabel,
  type JobReceiptRow,
  type PaymentReceipt,
} from "./receipt-format";
import {
  notifyReceiptToContractor,
  notifyReceiptToCustomer,
  notifyReceiptToOwner,
  type ReceiptText,
} from "./notify/payments";
import type { DocReceipt } from "./documents";
import type { Quote, Session } from "./types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;

export type { PaymentReceipt } from "./receipt-format";

type StaffForReceipt = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: string;
  business_name: string | null;
  business_address: string | null;
};

async function staffForReceipt(id: string | null | undefined): Promise<StaffForReceipt | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const res = await pgAdmin(
    `staff?id=eq.${id}&select=id,full_name,phone,role,business_name,business_address&limit=1`,
  );
  if (!res.ok) return null;
  return ((await res.json()) as StaffForReceipt[])[0] ?? null;
}

async function quoteAdmin(id: string): Promise<Quote | null> {
  if (!UUID_RE.test(id)) return null;
  const res = await pgAdmin(`quote_requests?id=eq.${id}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as Quote[])[0] ?? null;
}

/** The live (unvoided) receipt for a payment, if one has been issued. */
export async function liveReceiptForPayment(paymentId: string): Promise<PaymentReceipt | null> {
  if (!UUID_RE.test(paymentId)) return null;
  const res = await pgAdmin(`payment_receipts?payment_id=eq.${paymentId}&voided_at=is.null&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as PaymentReceipt[])[0] ?? null;
}

export async function receiptByToken(token: string): Promise<PaymentReceipt | null> {
  if (!TOKEN_RE.test(token)) return null;
  const res = await pgAdmin(`payment_receipts?token=eq.${token}&select=*&limit=1`);
  if (!res.ok) return null;
  return ((await res.json()) as PaymentReceipt[])[0] ?? null;
}

/** The numbers of the receipts these point at (replaces / replaced by), for "Replaces #000041". */
export async function receiptNumbersById(ids: (string | null | undefined)[]): Promise<Map<string, number>> {
  const want = [...new Set(ids.filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
  const out = new Map<string, number>();
  if (want.length === 0) return out;
  const res = await pgAdmin(`payment_receipts?id=in.(${want.join(",")})&select=id,receipt_number`);
  if (!res.ok) return out;
  for (const r of (await res.json()) as { id: string; receipt_number: number }[]) out.set(r.id, r.receipt_number);
  return out;
}

/** A job's receipts as the signed-in user may see them (RLS: owner, or the job's contractor). */
export async function listReceiptsForJob(session: Session, quoteId: string): Promise<PaymentReceipt[]> {
  if (!UUID_RE.test(quoteId)) return [];
  const res = await pgUser(
    `payment_receipts?quote_id=eq.${quoteId}&select=*&order=receipt_number.asc`,
    session.accessToken,
  );
  if (!res.ok) {
    console.error("[receipts] job list failed", quoteId, res.status);
    return [];
  }
  return (await res.json()) as PaymentReceipt[];
}

/** Every receipt issued in [from, to), oldest first, as the signed-in user may see them. Paged past 1000. */
export async function listReceiptsIssued(
  session: Session,
  fromIso: string,
  toIso: string,
): Promise<{ rows: PaymentReceipt[]; ok: boolean }> {
  const rows: PaymentReceipt[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const res = await pgUser(
      `payment_receipts?issued_at=gte.${encodeURIComponent(fromIso)}&issued_at=lt.${encodeURIComponent(toIso)}` +
        `&select=*&order=receipt_number.asc&limit=${PAGE}&offset=${offset}`,
      session.accessToken,
    );
    if (!res.ok) {
      console.error("[receipts] list failed", res.status);
      return { rows, ok: false };
    }
    const page = (await res.json()) as PaymentReceipt[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, ok: true };
}

/** Every receipt the signed-in user may see, just what the Documents index groups by job. Paged past 1000. */
export async function listReceiptsForHub(session: Session): Promise<{ rows: DocReceipt[]; ok: boolean }> {
  const rows: DocReceipt[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const res = await pgUser(
      `payment_receipts?select=id,quote_id,amount_cents,issued_at,voided_at,is_test&order=receipt_number.asc&limit=${PAGE}&offset=${offset}`,
      session.accessToken,
    );
    if (!res.ok) {
      console.error("[receipts] hub list failed", res.status);
      return { rows, ok: false };
    }
    const page = (await res.json()) as DocReceipt[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return { rows, ok: true };
}

function textOf(r: PaymentReceipt): ReceiptText {
  return {
    number: receiptNumberLabel(r.receipt_number),
    token: r.token,
    quoteId: r.quote_id,
    amountCents: r.amount_cents,
    method: methodLabel(r.method),
    customerName: r.customer_name,
    payee: payeeName(r),
    job: [r.job_service, r.job_address].filter(Boolean).join(", ") || null,
  };
}

/**
 * Issue the receipt for a paid payment, or return the one it already has. Safe to call twice, and from two
 * places at once (the Stripe webhook and the customer's return page): the database allows one live receipt
 * per payment, and the loser of a race reads the winner's.
 */
export async function ensureReceipt(input: {
  paymentId: string;
  customerCopy: boolean;
  replacesId?: string | null;
}): Promise<{ receipt: PaymentReceipt | null; created: boolean; paidTo: StaffForReceipt | null }> {
  const existing = await liveReceiptForPayment(input.paymentId);
  if (existing) return { receipt: existing, created: false, paidTo: null };

  const payment = await paymentById(input.paymentId);
  // Only money that actually arrived gets a receipt: not a pending checkout, not a voided row.
  if (!payment || payment.status !== "paid") return { receipt: null, created: false, paidTo: null };
  const quote = await quoteAdmin(payment.quote_id);
  if (!quote) {
    console.error("[receipts] job not found for payment", input.paymentId);
    return { receipt: null, created: false, paidTo: null };
  }

  // The customer pays the job's contractor. With nobody assigned, whoever took the money.
  const [paidTo, recorder, { ledger }] = await Promise.all([
    staffForReceipt(quote.assigned_to ?? payment.recorded_by),
    staffForReceipt(payment.recorded_by),
    jobLedger(quote),
  ]);

  // Street and city, as the quote PDF prints it.
  const address =
    [quote.address, quote.city && !quote.address?.includes(quote.city) ? quote.city : null].filter(Boolean).join(", ") ||
    null;
  const snapshot = buildReceiptSnapshot({
    payment,
    quote: { ...quote, address },
    paidTo,
    recorder,
    ledger,
    customerCopy: input.customerCopy,
    replacesId: input.replacesId ?? null,
  });

  const res = await pgAdmin("rpc/issue_payment_receipt", {
    method: "POST",
    body: JSON.stringify({ r: snapshot }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 409: another call issued it a moment ago.
    if (res.status === 409) {
      return { receipt: await liveReceiptForPayment(input.paymentId), created: false, paidTo };
    }
    console.error("[receipts] issue failed", input.paymentId, res.status, detail);
    return { receipt: null, created: false, paidTo };
  }
  const receipt = (await res.json()) as PaymentReceipt;
  await addAdminEvent(quote.id, "receipt_issued", {
    receipt_id: receipt.id,
    number: receipt.receipt_number,
    payment_id: payment.id,
    amount_cents: receipt.amount_cents,
    replaces: input.replacesId ?? null,
  });
  return { receipt, created: true, paidTo };
}

/**
 * Text the copies of a receipt just issued. The contractor's copy goes to whoever was paid unless that is an
 * owner (owners get the owner copy), and each copy is skipped when another text to that person already
 * carried the link. The customer's goes to the phone on the receipt, only when the box was ticked.
 */
export async function sendReceiptCopies(
  receipt: PaymentReceipt,
  opts: { paidTo: StaffForReceipt | null; ownerAlreadyTold: boolean; contractorAlreadyTold?: boolean },
): Promise<void> {
  const t = textOf(receipt);
  const jobs: Promise<unknown>[] = [];
  if (!opts.contractorAlreadyTold && opts.paidTo?.phone && opts.paidTo.role !== "owner") {
    jobs.push(notifyReceiptToContractor(t, opts.paidTo.phone));
  }
  if (!opts.ownerAlreadyTold) jobs.push(notifyReceiptToOwner(t));
  if (receipt.customer_copy_requested && receipt.customer_phone) {
    jobs.push(
      notifyReceiptToCustomer(t, receipt.customer_phone).then(async (sent) => {
        // Sent now, or queued for 8am in quiet hours: either way it is on its way.
        if (!sent.ok && !sent.held) return;
        await pgAdmin(`payment_receipts?id=eq.${receipt.id}&customer_copy_sent_at=is.null`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ customer_copy_sent_at: new Date().toISOString() }),
        });
      }),
    );
  }
  await Promise.all(jobs.map((j) => j.catch((e) => console.error("[receipts] copy failed", receipt.id, e))));
}

/** Issue and send, for a payment that just counted. Never throws. */
export async function receiptForNewPayment(input: {
  paymentId: string;
  customerCopy: boolean;
  ownerAlreadyTold: boolean;
}): Promise<PaymentReceipt | null> {
  try {
    const { receipt, created, paidTo } = await ensureReceipt({
      paymentId: input.paymentId,
      customerCopy: input.customerCopy,
    });
    if (receipt && created) {
      await sendReceiptCopies(receipt, { paidTo, ownerAlreadyTold: input.ownerAlreadyTold });
    }
    return receipt;
  } catch (e) {
    console.error("[receipts] receipt for new payment failed", input.paymentId, e);
    return null;
  }
}

/** Void a payment's live receipt, with the reason printed on it. Returns the voided receipt, if there was one. */
export async function voidReceiptForPayment(
  paymentId: string,
  reason: string,
  voidedBy: string | null,
): Promise<PaymentReceipt | null> {
  const live = await liveReceiptForPayment(paymentId);
  if (!live) return null;
  const res = await pgAdmin(`payment_receipts?id=eq.${live.id}&voided_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      voided_at: new Date().toISOString(),
      void_reason: reason.trim().slice(0, 300),
      voided_by: voidedBy,
    }),
  });
  if (!res.ok) {
    console.error("[receipts] void failed", live.id, res.status, await res.text().catch(() => ""));
    return null;
  }
  const voided = ((await res.json()) as PaymentReceipt[])[0] ?? null;
  if (voided) {
    await addAdminEvent(live.quote_id, "receipt_voided", {
      receipt_id: live.id,
      number: live.receipt_number,
      reason: voided.void_reason,
    });
  }
  return voided;
}

/**
 * A corrected payment: void its receipt and issue one for the corrected figures, each pointing at the other.
 * A payment recorded before receipts existed has none to void, and simply gets its first. Only the customer's
 * copy is sent from here: the "payment corrected" text the contractor and the other owners get carries the
 * new receipt's link. Never throws.
 */
export async function reissueAfterCorrection(input: {
  paymentId: string;
  reason: string;
  actor: Session;
  customerCopy: boolean;
}): Promise<PaymentReceipt | null> {
  try {
    const voided = await voidReceiptForPayment(input.paymentId, input.reason, input.actor.staff.id);
    const { receipt, created, paidTo } = await ensureReceipt({
      paymentId: input.paymentId,
      customerCopy: input.customerCopy,
      replacesId: voided?.id ?? null,
    });
    if (!receipt || !created) return receipt;
    if (voided) {
      await pgAdmin(`payment_receipts?id=eq.${voided.id}&replaced_by_receipt_id=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ replaced_by_receipt_id: receipt.id }),
      });
    }
    await sendReceiptCopies(receipt, { paidTo, ownerAlreadyTold: true, contractorAlreadyTold: true });
    return receipt;
  } catch (e) {
    console.error("[receipts] reissue failed", input.paymentId, e);
    return null;
  }
}

/** A job's receipts for the list, with the number each replacement points back at. */
export function receiptRowsFor(receipts: PaymentReceipt[]): JobReceiptRow[] {
  const numberOf = new Map(receipts.map((r) => [r.id, r.receipt_number]));
  return receipts.map((r) => ({
    id: r.id,
    token: r.token,
    receipt_number: r.receipt_number,
    amount_cents: r.amount_cents,
    method: r.method,
    issued_at: r.issued_at,
    voided_at: r.voided_at,
    void_reason: r.void_reason,
    replaces_number: r.replaces_receipt_id ? (numberOf.get(r.replaces_receipt_id) ?? null) : null,
    customer_copy_requested: r.customer_copy_requested,
    customer_copy_sent_at: r.customer_copy_sent_at,
  }));
}
