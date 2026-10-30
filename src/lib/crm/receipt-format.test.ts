// What a receipt says, and the CSV the owner hands an accountant. A wrong figure here doesn't throw: it sits on
// a tax record until someone notices, so the arithmetic and the edge cases are pinned down.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { PDFDocument } from "pdf-lib";

import { buildReceiptPdf } from "./receipt-pdf.ts";
import {
  buildReceiptSnapshot,
  easternYearStartIso,
  payeeName,
  receiptMoney,
  receiptNumberLabel,
  receiptsCsv,
  receiptTime,
  receiptYear,
  type PaymentReceipt,
  type ReceiptSnapshotInput,
} from "./receipt-format.ts";

const input = (over: Partial<ReceiptSnapshotInput> = {}): ReceiptSnapshotInput => ({
  payment: {
    id: "11111111-1111-4111-8111-111111111111",
    quote_id: "22222222-2222-4222-8222-222222222222",
    amount_cents: 425000,
    method: "zelle",
    note: "  half up front  ",
    paid_at: "2026-10-30T19:42:00.000Z",
    created_at: "2026-10-30T19:41:00.000Z",
    recorded_by: "33333333-3333-4333-8333-333333333333",
  },
  quote: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Josh  Joyner",
    phone: "(252) 904-9889",
    email: null,
    service: "Patio",
    address: "5604 Merion Station Drive, Apex",
  },
  paidTo: {
    id: "44444444-4444-4444-8444-444444444444",
    full_name: "Mike Smith",
    phone: "+19195550100",
    business_name: "Smith Concrete LLC",
    business_address: "1 Main St, Raleigh, NC 27601",
  },
  recorder: { id: "33333333-3333-4333-8333-333333333333", full_name: "Mike Smith" },
  ledger: { totalCents: 850000, paidCents: 425000, dueCents: 425000 },
  customerCopy: true,
  ...over,
});

const receipt = (over: Partial<PaymentReceipt> = {}): PaymentReceipt => ({
  id: "r1",
  receipt_number: 1,
  token: "a".repeat(32),
  payment_id: "p1",
  quote_id: "q1",
  is_test: false,
  issued_at: "2026-10-30T19:42:05.000Z",
  paid_at: "2026-10-30T19:42:00.000Z",
  amount_cents: 425000,
  method: "zelle",
  payment_note: null,
  customer_name: "Josh Joyner",
  customer_phone: null,
  customer_email: null,
  job_service: "Patio",
  job_address: "5604 Merion Station Drive, Apex",
  paid_to_staff_id: null,
  paid_to_name: "Mike Smith",
  paid_to_business_name: "Smith Concrete LLC",
  paid_to_business_address: null,
  paid_to_phone: null,
  recorded_by: null,
  recorded_by_name: "Mike Smith",
  job_total_cents: 850000,
  paid_to_date_cents: 425000,
  balance_cents: 425000,
  replaces_receipt_id: null,
  replaced_by_receipt_id: null,
  voided_at: null,
  void_reason: null,
  voided_by: null,
  customer_copy_requested: true,
  customer_copy_sent_at: null,
  ...over,
});

// ── The snapshot ────────────────────────────────────────────────────────────

test("snapshot: the payment, the payee and the job's money as they stand", () => {
  const s = buildReceiptSnapshot(input());
  assert.equal(s.amount_cents, 425000);
  assert.equal(s.method, "zelle");
  assert.equal(s.paid_at, "2026-10-30T19:42:00.000Z");
  assert.equal(s.customer_name, "Josh Joyner", "spaces collapsed");
  assert.equal(s.payment_note, "half up front", "trimmed");
  assert.equal(s.paid_to_name, "Mike Smith");
  assert.equal(s.paid_to_business_name, "Smith Concrete LLC");
  assert.equal(s.job_total_cents, 850000);
  assert.equal(s.paid_to_date_cents, 425000);
  assert.equal(s.balance_cents, 425000);
  assert.equal(s.customer_copy_requested, true);
  assert.equal(s.replaces_receipt_id, null);
  assert.equal(s.is_test, false);
});

test("snapshot: a card row not yet stamped falls back to when it was created", () => {
  const i = input();
  const s = buildReceiptSnapshot({ ...i, payment: { ...i.payment, paid_at: null } });
  assert.equal(s.paid_at, "2026-10-30T19:41:00.000Z");
});

test("snapshot: the payee always has a name", () => {
  const i = input();
  assert.equal(buildReceiptSnapshot({ ...i, paidTo: { ...i.paidTo!, full_name: " " } }).paid_to_name, "Smith Concrete LLC");
  assert.equal(buildReceiptSnapshot({ ...i, paidTo: null }).paid_to_name, "Your contractor");
  assert.equal(buildReceiptSnapshot({ ...i, paidTo: null }).paid_to_staff_id, null);
});

test("snapshot: blanks are null, never empty strings, and long text fits its column", () => {
  const i = input();
  const s = buildReceiptSnapshot({
    ...i,
    payment: { ...i.payment, note: "   " },
    quote: { ...i.quote, address: "", name: "x".repeat(300) },
  });
  assert.equal(s.payment_note, null);
  assert.equal(s.job_address, null);
  assert.equal((s.customer_name as string).length, 200);
});

test("snapshot: a nameless customer still gets a receipt", () => {
  const i = input();
  assert.equal(buildReceiptSnapshot({ ...i, quote: { ...i.quote, name: "  " } }).customer_name, "Customer");
});

test("snapshot: a reissue points at the receipt it replaces, and keeps the box as ticked", () => {
  const s = buildReceiptSnapshot(input({ replacesId: "r-old", customerCopy: false }));
  assert.equal(s.replaces_receipt_id, "r-old");
  assert.equal(s.customer_copy_requested, false);
});

// ── How it reads ────────────────────────────────────────────────────────────

test("numbers are six digits, so they file in order", () => {
  assert.equal(receiptNumberLabel(1), "#000001");
  assert.equal(receiptNumberLabel(42), "#000042");
  assert.equal(receiptNumberLabel(1234567), "#1234567");
});

test("money is always dollars and cents", () => {
  assert.equal(receiptMoney(425000), "$4,250.00");
  assert.equal(receiptMoney(5), "$0.05");
  assert.equal(receiptMoney(0), "$0.00");
  assert.equal(receiptMoney(null), "$0.00");
  assert.equal(receiptMoney(100000000), "$1,000,000.00");
  assert.equal(receiptMoney(-1250), "-$12.50");
});

test("times are Raleigh time with the zone named, standard and daylight", () => {
  assert.equal(receiptTime("2026-10-30T19:42:00.000Z"), "Oct 30, 2026, 3:42 PM EDT");
  assert.equal(receiptTime("2026-12-15T17:05:00.000Z"), "Dec 15, 2026, 12:05 PM EST");
});

test("a payment late on Dec 31 belongs to that year, in Raleigh", () => {
  assert.equal(receiptYear("2027-01-01T04:30:00.000Z"), 2026, "11:30 PM Dec 31 Eastern");
  assert.equal(receiptYear("2027-01-01T05:00:00.000Z"), 2027, "midnight Eastern");
});

test("a year starts at Raleigh midnight on January 1", () => {
  for (const year of [2026, 2027, 2030]) {
    const start = easternYearStartIso(year);
    assert.equal(receiptYear(start), year);
    assert.equal(receiptYear(new Date(new Date(start).getTime() - 1).toISOString()), year - 1);
  }
});

test("the payee leads with the business when there is one", () => {
  assert.equal(payeeName(receipt()), "Smith Concrete LLC");
  assert.equal(payeeName(receipt({ paid_to_business_name: null })), "Mike Smith");
});

// ── The export ──────────────────────────────────────────────────────────────

test("CSV: header, rows in number order, plain-number amounts, CRLF", () => {
  const csv = receiptsCsv([receipt({ id: "b", receipt_number: 2 }), receipt({ id: "a", receipt_number: 1 })], () => undefined);
  const lines = csv.split("\r\n");
  assert.ok(lines[0].startsWith("Receipt,Status,Issued (Eastern)"));
  assert.ok(lines[1].startsWith("#000001,Issued,"));
  assert.ok(lines[2].startsWith("#000002,Issued,"));
  assert.ok(lines[1].includes(",4250.00,Zelle,"));
  assert.equal(lines[3], "", "ends with a line break");
});

test("CSV: a void stays in the book, with its reason and what replaced it", () => {
  const csv = receiptsCsv(
    [
      receipt({ id: "old", receipt_number: 1, voided_at: "2026-10-31T12:00:00.000Z", void_reason: "Payment corrected" }),
      receipt({ id: "new", receipt_number: 2, amount_cents: 400000, replaces_receipt_id: "old" }),
    ],
    (id) => (id === "old" ? 1 : undefined),
  );
  const [, first, second] = csv.split("\r\n");
  assert.ok(first.startsWith("#000001,Void,"));
  assert.ok(first.includes("Payment corrected"));
  assert.ok(second.includes(",#000001,"), "replaces column");
});

test("CSV: commas, quotes and formulas can't break or run in a spreadsheet", () => {
  const csv = receiptsCsv([receipt({ customer_name: 'Smith, "Bob"', job_service: "=HYPERLINK(1)" })], () => undefined);
  const row = csv.split("\r\n")[1];
  assert.ok(row.includes('"Smith, ""Bob"""'));
  assert.ok(row.includes(`"'=HYPERLINK(1)"`));
});

test("CSV: a card payment the customer made online says so", () => {
  const row = receiptsCsv([receipt({ method: "card", recorded_by: null, recorded_by_name: null })], () => undefined).split("\r\n")[1];
  assert.ok(row.includes(",Card,"));
  assert.ok(row.includes("Customer, online") || row.includes('"Customer, online"'));
});

// ── The PDF ─────────────────────────────────────────────────────────────────

test("PDF: one page, for a live receipt and a void one", async () => {
  for (const r of [
    receipt(),
    receipt({ voided_at: "2026-10-31T12:00:00.000Z", void_reason: "Payment corrected from $4,250.00 to $4,000.00", is_test: true }),
  ]) {
    const bytes = await buildReceiptPdf(
      { receipt: r, businessName: "Raleigh Concrete Group", businessPhone: "(919) 873-3919", website: "raleighconcrete.net", replacesNumber: null, replacedByNumber: 2 },
      null,
    );
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getTitle(), "Receipt #000001");
  }
});

test("PDF: text the font can't draw doesn't break it", async () => {
  const bytes = await buildReceiptPdf(
    {
      receipt: receipt({ customer_name: "José 😀 Ngô", paid_to_name: "Łukasz" }),
      businessName: "Raleigh Concrete Group",
      businessPhone: "(919) 873-3919",
      website: "raleighconcrete.net",
      replacesNumber: 1,
      replacedByNumber: null,
    },
    null,
  );
  assert.ok(bytes.length > 1000);
});
