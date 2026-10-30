// Server-only SMS notifications: job complete and payment texts. Never import from a client component.
// Re-exported from ../notify.ts, whose header documents the provider settings.
// Ledger money is in cents and must print with them ("$6,172.50", not
// "$6,172.5"), unlike the local dollars-only `usd`.
import { usd as money } from "../fees";
import { type SendResult, samePhone, sendSmsResult, sendSms, alertOwner } from "./send";
import { REVIEW_URL, BUSINESS, block, text, type QuoteInfo, firstName } from "./format";
import { jobLink, payLink, receiptLink } from "./templates";

// ── 11. Job complete + paid: thank the customer and ask for a review ────────
export async function notifyComplete(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "thank you for choosing us and for supporting a local business. We hope you love how it turned out!",
      ...(REVIEW_URL
        ? ["", "If you have a minute, a quick Google review would mean a lot to our small team:", REVIEW_URL]
        : []),
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "complete", role: "customer" },
  ).catch(() => {});
}

// ── Payment: text the customer their card link ──────────────────────────────
// The crew's "send a card link" button. States the amount and stops: the page
// handles deposit vs balance, and arguing for payment reads like collections.
export async function notifyPayLink(q: QuoteInfo, dueCents: number): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `here's your secure payment link for your project with ${BUSINESS}.`,
      "",
      ...(dueCents > 0 ? [`Balance: ${money(dueCents)}`, ""] : []),
      payLink(q.public_token ?? ""),
      "",
      "Card, Apple Pay or Google Pay. You can pay it all or part of it.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "pay_link", role: "customer" },
  );
}

// ── Payment: the crew took money on site ────────────────────────────────────
// Cash counts as soon as the crew records it, so this text IS the control: the
// owner hears immediately, while a mistake is still cheap to fix.
export async function notifyCashRecorded(input: {
  q: QuoteInfo;
  amountCents: number;
  method: string;
  who: string;
  dueCents: number;
  feeOwedCents: number;
  /** The receipt just issued for it: this text is the owner's copy. */
  receipt?: { number: string; token: string } | null;
}): Promise<void> {
  const { q, amountCents, method, who, dueCents, feeOwedCents, receipt } = input;
  await alertOwner(
    text([
      `PAYMENT RECORDED - ${method.toUpperCase()}`,
      "",
      ...block("Amount:", money(amountCents)),
      ...block("Customer:", q.name),
      ...block("Taken by:", who),
      ...block("Still due from customer:", dueCents > 0 ? money(dueCents) : "Nothing - paid in full"),
      // Card payments pay the office automatically; cash doesn't, so the fee is
      // now a debt the owner should hear about now, not at month end.
      ...block("They now owe you:", feeOwedCents > 0 ? money(feeOwedCents) : "Nothing on this job"),
      ...(receipt ? block(`Receipt ${receipt.number}:`, receiptLink(receipt.token)) : []),
      q.job_token ? jobLink(q.job_token) : null,
    ]),
    null,
    { quoteId: q.id, kind: "cash_recorded" },
  );
}

// ── Receipts ────────────────────────────────────────────────────────────────
// Every customer payment gets a numbered receipt. Copies: the contractor who was paid, the owner, and the
// customer when the box was ticked. The customer's copy never carries the amount (no figures in customer
// texts); the receipt behind the link has it.
export type ReceiptText = {
  number: string;
  token: string;
  quoteId: string;
  amountCents: number;
  method: string;
  customerName: string;
  payee: string;
  job: string | null;
};

/** The contractor's copy. Never sent to an owner, whose copy is the owner text. */
export async function notifyReceiptToContractor(r: ReceiptText, phone: string): Promise<void> {
  await sendSms(
    phone,
    text([
      `RECEIPT ${r.number}`,
      "",
      `${r.customerName} paid you ${money(r.amountCents)} (${r.method}).`,
      "",
      ...block("Job:", r.job),
      receiptLink(r.token),
    ]),
    { quoteId: r.quoteId, kind: "receipt_crew", role: "crew" },
  ).catch(() => {});
}

/** The owner's copy, where no payment text already carried it (card payments). */
export async function notifyReceiptToOwner(r: ReceiptText): Promise<void> {
  await alertOwner(
    text([
      `RECEIPT ${r.number}`,
      "",
      `${r.customerName} paid ${r.payee} ${money(r.amountCents)} (${r.method}).`,
      "",
      receiptLink(r.token),
    ]),
    null,
    { quoteId: r.quoteId, kind: "receipt_owner" },
  );
}

/** The customer's copy. Quiet hours hold it until 8am like any customer text. */
export async function notifyReceiptToCustomer(r: ReceiptText, customerPhone: string): Promise<SendResult> {
  return sendSmsResult(
    customerPhone,
    text([
      `Hi ${firstName(r.customerName)},`,
      `here's your receipt for your payment to ${r.payee}.`,
      "",
      receiptLink(r.token),
      "",
      BUSINESS,
    ]),
    { quoteId: r.quoteId, kind: "receipt_customer", role: "customer" },
  );
}

// ── A payment the office had to correct ─────────────────────────────────────
// The crew acted on a figure that changed: what's left to collect and what they
// owe the office. Never sent to whoever made the correction.
export async function notifyPaymentCorrected(input: {
  q: QuoteInfo;
  contractorPhone?: string | null;
  actorPhone?: string | null;
  fromCents: number;
  /** Null means the row was voided rather than re-figured. */
  toCents: number | null;
  method: string;
  who: string;
  dueCents: number;
  feeOwedCents: number;
  /** The receipt issued for the corrected payment (the old one is void): this text is everyone's copy. */
  receipt?: { number: string; token: string } | null;
}): Promise<void> {
  const { q, fromCents, toCents, method, who } = input;
  const what =
    toCents === null
      ? `${money(fromCents)} recorded as ${method} has been taken off this job - it should not have been there.`
      : `The ${money(fromCents)} recorded as ${method} was wrong. It is now ${money(toCents)}.`;

  const msg = text([
    "PAYMENT CORRECTED",
    "",
    ...block("Customer:", q.name),
    what,
    "",
    ...block("Still to collect:", money(input.dueCents)),
    // Their balance with the office is a percentage of what was actually collected.
    ...block("You owe the office:", money(input.feeOwedCents)),
    `Corrected by ${who}.`,
    "",
    ...(input.receipt ? block(`New receipt ${input.receipt.number} (the old one is void):`, receiptLink(input.receipt.token)) : []),
    q.job_token ? jobLink(q.job_token) : null,
  ]);

  await alertOwner(msg, input.actorPhone, { quoteId: q.id, kind: "payment_corrected" });
  if (input.contractorPhone && !samePhone(input.contractorPhone, input.actorPhone)) {
    await sendSms(input.contractorPhone, msg, {
      quoteId: q.id,
      kind: "payment_corrected",
      role: "crew",
    }).catch(() => {});
  }
}
