// What a payment receipt says. Pure: no network, no database, so the snapshot a receipt is issued with, the
// way it reads and the CSV the owner hands an accountant are all tested (receipt-format.test.ts).
//
// The customer pays the CONTRACTOR, not the office (the contractor pays the office its fee separately), so
// a receipt names the contractor as the one paid, and only says Raleigh Concrete Group arranged the job.
import { BUSINESS_TZ } from "./clock.ts";
import { METHOD_LABELS, type PaymentMethod } from "./fees.ts";

/** A row of public.payment_receipts. Everything on it was frozen when it was issued. */
export type PaymentReceipt = {
  id: string;
  receipt_number: number;
  token: string;
  payment_id: string;
  quote_id: string;
  is_test: boolean;
  issued_at: string;
  paid_at: string;
  amount_cents: number;
  method: string;
  payment_note: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  job_service: string | null;
  job_address: string | null;
  paid_to_staff_id: string | null;
  paid_to_name: string;
  paid_to_business_name: string | null;
  paid_to_business_address: string | null;
  paid_to_phone: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  job_total_cents: number | null;
  paid_to_date_cents: number | null;
  balance_cents: number | null;
  replaces_receipt_id: string | null;
  replaced_by_receipt_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
  customer_copy_requested: boolean;
  customer_copy_sent_at: string | null;
};

/** A receipt as a job page lists it. */
export type JobReceiptRow = {
  id: string;
  token: string;
  receipt_number: number;
  amount_cents: number;
  method: string;
  issued_at: string;
  voided_at: string | null;
  void_reason: string | null;
  replaces_number: number | null;
  customer_copy_requested: boolean;
  customer_copy_sent_at: string | null;
};

export type ReceiptSnapshotInput = {
  payment: {
    id: string;
    quote_id: string;
    amount_cents: number;
    method: string;
    note: string | null;
    paid_at: string | null;
    created_at: string;
    recorded_by: string | null;
  };
  quote: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    service: string | null;
    address: string | null;
    is_test?: boolean;
  };
  /** The job's contractor, else whoever recorded the payment. Null only if neither can be read. */
  paidTo: {
    id: string;
    full_name: string | null;
    phone: string | null;
    business_name: string | null;
    business_address: string | null;
  } | null;
  recorder: { id: string; full_name: string | null } | null;
  /** The job's money right after this payment. */
  ledger: { totalCents: number; paidCents: number; dueCents: number };
  customerCopy: boolean;
  replacesId?: string | null;
};

const clean = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

/** The JSON issue_payment_receipt() stores. Column limits applied here, so a long name never fails an issue. */
export function buildReceiptSnapshot(i: ReceiptSnapshotInput): Record<string, unknown> {
  const p = i.paidTo;
  const paidToName = clean(p?.full_name, 200) ?? clean(p?.business_name, 200) ?? "Your contractor";
  return {
    payment_id: i.payment.id,
    quote_id: i.quote.id,
    is_test: Boolean(i.quote.is_test),
    // When the money changed hands: a card row is stamped when Stripe confirms it, a recorded one when saved.
    paid_at: i.payment.paid_at ?? i.payment.created_at,
    amount_cents: i.payment.amount_cents,
    method: i.payment.method,
    payment_note: clean(i.payment.note, 500),
    customer_name: clean(i.quote.name, 200) ?? "Customer",
    customer_phone: clean(i.quote.phone, 40),
    customer_email: clean(i.quote.email, 200),
    job_service: clean(i.quote.service, 200),
    job_address: clean(i.quote.address, 300),
    paid_to_staff_id: p?.id ?? null,
    paid_to_name: paidToName,
    paid_to_business_name: clean(p?.business_name, 120),
    paid_to_business_address: clean(p?.business_address, 300),
    paid_to_phone: clean(p?.phone, 40),
    recorded_by: i.recorder?.id ?? null,
    recorded_by_name: clean(i.recorder?.full_name, 200),
    job_total_cents: i.ledger.totalCents,
    paid_to_date_cents: i.ledger.paidCents,
    balance_cents: i.ledger.dueCents,
    replaces_receipt_id: i.replacesId ?? null,
    customer_copy_requested: i.customerCopy,
  };
}

/** "#000042": fixed width, so receipts sort and file in order. */
export function receiptNumberLabel(n: number): string {
  return `#${String(n).padStart(6, "0")}`;
}

/** Who was paid, as the receipt leads with it: the business when there is one, else the person. */
export function payeeName(r: Pick<PaymentReceipt, "paid_to_name" | "paid_to_business_name">): string {
  return r.paid_to_business_name || r.paid_to_name;
}

export function methodLabel(method: string): string {
  return METHOD_LABELS[method as PaymentMethod] ?? method;
}

/** Dollars and cents, always both: a receipt never rounds. */
export function receiptMoney(cents: number | null | undefined): string {
  const n = Number(cents ?? 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** A moment in Raleigh time with the zone named, e.g. "Oct 30, 2026, 3:42 PM EDT". */
export function receiptTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: BUSINESS_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * The instant a calendar year starts in Raleigh. January 1 is always on standard time there (EST, UTC-5), so
 * local midnight is 05:00 UTC; no daylight-saving lookup can get it wrong.
 */
export function easternYearStartIso(year: number): string {
  return `${String(year).padStart(4, "0")}-01-01T05:00:00.000Z`;
}

/** The calendar year a receipt falls in, in Raleigh time: a payment at 11pm on Dec 31 is that year's. */
export function receiptYear(iso: string): number {
  return Number(new Date(iso).toLocaleString("en-US", { timeZone: BUSINESS_TZ, year: "numeric" }));
}

const CSV_COLUMNS = [
  "Receipt",
  "Status",
  "Issued (Eastern)",
  "Paid (Eastern)",
  "Customer",
  "Job",
  "Job address",
  "Amount",
  "Method",
  "Paid to",
  "Paid to business",
  "Recorded by",
  "Job total after",
  "Paid to date after",
  "Balance after",
  "Replaces receipt",
  "Void reason",
  "Practice",
] as const;

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  // Quote anything with a comma, quote, line break or a leading formula character (spreadsheets would run it).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Every receipt as one CSV row, voided ones included and marked: a book with gaps in its numbering is what an
 * accountant asks about. Amounts are plain numbers (1234.50) so a spreadsheet can add them up.
 */
export function receiptsCsv(rows: PaymentReceipt[], numberOf: (id: string) => number | undefined): string {
  const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of [...rows].sort((a, b) => a.receipt_number - b.receipt_number)) {
    const replaced = r.replaces_receipt_id ? numberOf(r.replaces_receipt_id) : undefined;
    lines.push(
      [
        receiptNumberLabel(r.receipt_number),
        r.voided_at ? "Void" : "Issued",
        receiptTime(r.issued_at),
        receiptTime(r.paid_at),
        r.customer_name,
        r.job_service,
        r.job_address,
        dollars(r.amount_cents),
        methodLabel(r.method),
        r.paid_to_name,
        r.paid_to_business_name,
        r.recorded_by_name ?? (r.recorded_by ? "" : "Customer, online"),
        dollars(r.job_total_cents),
        dollars(r.paid_to_date_cents),
        dollars(r.balance_cents),
        replaced != null ? receiptNumberLabel(replaced) : "",
        r.void_reason,
        r.is_test ? "Yes" : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
