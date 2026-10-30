// A payment receipt as a one-page PDF, for the contractor's and the owner's books and the customer's records.
// Drawn with pdf-lib like the quote PDF (quote-pdf.ts): text at fixed coordinates, every string through
// pdfText() so anything typed comes out as text the built-in font can draw.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";

import { pdfText, wrapText } from "./quote-pdf.ts";
import {
  methodLabel,
  payeeName,
  receiptMoney,
  receiptNumberLabel,
  receiptTime,
  type PaymentReceipt,
} from "./receipt-format.ts";

export type ReceiptPdfData = {
  receipt: PaymentReceipt;
  businessName: string;
  businessPhone: string;
  website: string;
  /** Numbers of the receipts this one replaces / was replaced by, when there are any. */
  replacesNumber: number | null;
  replacedByNumber: number | null;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.85, 0.85, 0.87);
const VOID_RED = rgb(0.72, 0.11, 0.11);

export async function buildReceiptPdf(data: ReceiptPdfData, logoPng: Uint8Array | null): Promise<Uint8Array> {
  const r = data.receipt;
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${receiptNumberLabel(r.receipt_number)}`);
  doc.setAuthor(data.businessName);
  doc.setCreationDate(new Date(r.issued_at));
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  const t = (s: string | null | undefined) => pdfText(s ?? "", charset);

  let y = PAGE_H - MARGIN;
  const draw = (s: string, x: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(t(s), { x, y, size, font, color });
  const drawRight = (s: string, size: number, font: PDFFont, color = INK) => {
    const text = t(s);
    page.drawText(text, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(text, size), y, size, font, color });
  };
  const rule = () => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: RULE });
  };
  const para = (s: string, size: number, font: PDFFont, color = INK, width = CONTENT_W) => {
    for (const line of wrapText(t(s), font, size, width)) {
      page.drawText(line, { x: MARGIN, y, size, font, color });
      y -= size * 1.4;
    }
  };

  // Header: logo left, receipt number right.
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await doc.embedPng(logoPng);
    } catch {
      logo = null;
    }
  }
  if (logo) {
    const h = 34;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: MARGIN, y: y - h + 8, width: w, height: h });
  } else {
    draw(data.businessName, MARGIN, 14, bold);
  }
  drawRight("RECEIPT", 18, bold);
  y -= 20;
  drawRight(receiptNumberLabel(r.receipt_number), 12, regular, MUTED);
  y -= 30;

  if (r.voided_at) {
    page.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_W, height: 40, borderColor: VOID_RED, borderWidth: 1.5 });
    y -= 2;
    draw(`VOID - ${receiptTime(r.voided_at)}`, MARGIN + 10, 13, bold, VOID_RED);
    y -= 16;
    const why = (r.void_reason ?? "").replace(/[.\s]+$/, "");
    const tail = data.replacedByNumber != null ? ` Replaced by receipt ${receiptNumberLabel(data.replacedByNumber)}.` : "";
    // One line in the box: the reason is at most 300 characters, so a long one is shortened here (the page and
    // the CSV carry it whole).
    const line = wrapText(t(`${why}.${tail}`), regular, 9.5, CONTENT_W - 20);
    draw(line.length > 1 ? `${line[0].replace(/\s*\S*$/, "")}...` : line[0] ?? "", MARGIN + 10, 9.5, regular, VOID_RED);
    y -= 34;
  }
  if (r.is_test) {
    draw("PRACTICE RECEIPT - not a real payment", MARGIN, 10, bold, MUTED);
    y -= 20;
  }

  // The amount, then who paid whom.
  draw("Amount paid", MARGIN, 10, regular, MUTED);
  y -= 30;
  draw(receiptMoney(r.amount_cents), MARGIN, 30, bold);
  y -= 22;
  draw(`${methodLabel(r.method)} · paid ${receiptTime(r.paid_at)}`, MARGIN, 10.5, regular, MUTED);
  y -= 30;
  rule();
  y -= 24;

  const colW = CONTENT_W / 2 - 12;
  const top = y;
  draw("Paid to", MARGIN, 9, bold, MUTED);
  y -= 16;
  const payee = [
    payeeName(r),
    r.paid_to_business_name ? r.paid_to_name : null,
    r.paid_to_business_address,
    r.paid_to_phone,
  ].filter((v): v is string => Boolean(v));
  for (const [i, line] of payee.entries()) {
    for (const l of wrapText(t(line), i === 0 ? bold : regular, 11, colW)) {
      page.drawText(l, { x: MARGIN, y, size: 11, font: i === 0 ? bold : regular, color: INK });
      y -= 15;
    }
  }
  const leftBottom = y;

  y = top;
  const x2 = MARGIN + CONTENT_W / 2 + 12;
  page.drawText("Received from", { x: x2, y, size: 9, font: bold, color: MUTED });
  y -= 16;
  for (const l of wrapText(t(r.customer_name), bold, 11, colW)) {
    page.drawText(l, { x: x2, y, size: 11, font: bold, color: INK });
    y -= 15;
  }
  const job = [r.job_service, r.job_address].filter(Boolean).join(", ");
  if (job) {
    y -= 6;
    page.drawText("For", { x: x2, y, size: 9, font: bold, color: MUTED });
    y -= 15;
    for (const l of wrapText(t(job), regular, 10.5, colW)) {
      page.drawText(l, { x: x2, y, size: 10.5, font: regular, color: INK });
      y -= 14;
    }
  }
  y = Math.min(y, leftBottom) - 18;
  rule();
  y -= 22;

  // The job's money as it stood with this payment counted.
  const rows: [string, string][] = [];
  if (r.job_total_cents != null) rows.push(["Job total", receiptMoney(r.job_total_cents)]);
  if (r.paid_to_date_cents != null) rows.push(["Paid so far, including this payment", receiptMoney(r.paid_to_date_cents)]);
  if (r.balance_cents != null) rows.push(["Balance remaining", receiptMoney(r.balance_cents)]);
  for (const [label, value] of rows) {
    draw(label, MARGIN, 10.5, regular);
    drawRight(value, 10.5, label === "Balance remaining" ? bold : regular);
    y -= 18;
  }
  if (rows.length) {
    y -= 6;
    rule();
    y -= 22;
  }

  const facts: [string, string][] = [
    ["Receipt", receiptNumberLabel(r.receipt_number)],
    ["Issued", receiptTime(r.issued_at)],
    ["Recorded by", r.recorded_by_name ?? (r.recorded_by ? "Staff" : "Paid online by card")],
  ];
  if (data.replacesNumber != null) facts.push(["Replaces", `Receipt ${receiptNumberLabel(data.replacesNumber)} (void)`]);
  for (const [label, value] of facts) {
    draw(label, MARGIN, 9.5, regular, MUTED);
    page.drawText(t(value), { x: MARGIN + 110, y, size: 9.5, font: regular, color: INK });
    y -= 15;
  }
  y -= 14;

  para(
    `This payment was made to ${payeeName(r)}, who did the work. ${data.businessName} arranged the job and keeps this receipt on file; it is not a payment to ${data.businessName}.`,
    9,
    regular,
    MUTED,
  );

  // Footer.
  page.drawText(t(`${data.businessName} · ${data.businessPhone} · ${data.website}`), {
    x: MARGIN,
    y: MARGIN - 10,
    size: 8.5,
    font: regular,
    color: MUTED,
  });

  return doc.save();
}
