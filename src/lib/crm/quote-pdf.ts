// A quote as a one-or-more-page PDF the office can attach to an email or text.
//
// Drawn with pdf-lib: plain text and one image placed at fixed coordinates.
// Nothing here renders HTML, runs a browser, shells out or evaluates anything,
// so text the customer or staff typed can only ever come out as text. Every
// string goes through pdfText() first: the built-in Helvetica only covers
// WinAnsi, and pdf-lib throws on anything outside it.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

// `price` arrives formatted ("$4,200", or "-" for a line the customer turned down).
export type QuotePdfLine = { title: string; description: string | null; price: string; tag: string | null };

export type QuotePdfData = {
  businessName: string;
  phone: string;
  website: string;
  customerName: string;
  address: string | null;
  service: string | null;
  issuedOn: string;
  goodThrough: string | null;
  sections: (readonly [string, string])[];
  // Packages offered as a choice, labelled "Option A" etc. by the caller.
  packages: QuotePdfLine[];
  lines: QuotePdfLine[];
  totalLabel: string;
  total: string;
  totalNote: string | null;
  // Above the link: an invitation to approve, or on an approved quote, where to pay and check in.
  linkLabel: string;
  quoteUrl: string;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 30;

const INK = rgb(0.11, 0.11, 0.12);
const MUTED = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.85, 0.85, 0.87);
const SHADE = rgb(0.96, 0.96, 0.97);

/** Text the standard fonts can draw: no control characters, anything outside WinAnsi folded or dropped. */
export function pdfText(s: string, charset: Set<number>): string {
  let out = "";
  for (const ch of s.replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    const cp = ch.codePointAt(0) as number;
    if (ch === "\n") out += ch;
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    else if (charset.has(cp)) out += ch;
    else {
      // "é" survives as itself; "ő" becomes "o"; an emoji becomes nothing.
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += [...base].every((c) => charset.has(c.codePointAt(0) as number)) ? base : "";
    }
  }
  return out;
}

/** Greedy word wrap to a width; long unbroken words are split. Blank lines are kept. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/ +/).filter(Boolean)) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let cut = w.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) lines.push(line);
        lines.push(w.slice(0, cut));
        line = "";
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export async function buildQuotePdf(data: QuotePdfData, logoPng: Uint8Array | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.businessName} quote for ${data.customerName}`);
  doc.setAuthor(data.businessName);
  doc.setCreator(data.businessName);
  doc.setProducer(data.businessName);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  const t = (s: string | null | undefined) => pdfText(s ?? "", charset);

  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await doc.embedPng(logoPng);
    } catch {
      logo = null; // The name in text stands in.
    }
  }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const draw = (s: string, x: number, size: number, font: PDFFont = regular, color = INK) =>
    page.drawText(s, { x, y, size, font, color });
  const drawRight = (s: string, right: number, size: number, font: PDFFont = regular, color = INK) =>
    page.drawText(s, { x: right - font.widthOfTextAtSize(s, size), y, size, font, color });
  const rule = (at: number) =>
    page.drawLine({ start: { x: MARGIN, y: at }, end: { x: PAGE_W - MARGIN, y: at }, thickness: 0.75, color: RULE });
  // Start a new page when the next block won't fit above the footer.
  const room = (h: number) => {
    if (y - h >= MARGIN + FOOTER_H) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const paragraph = (text: string, size: number, font: PDFFont, color = INK, x = MARGIN, width = CONTENT_W) => {
    for (const line of wrapText(text, font, size, width)) {
      room(size * 1.4);
      y -= size * 1.4;
      if (line) draw(line, x, size, font, color);
    }
  };
  const heading = (s: string) => {
    room(40);
    y -= 22;
    draw(t(s).toUpperCase(), MARGIN, 9.5, bold, MUTED);
    y -= 8;
    rule(y);
  };

  // ── Header: logo left, how to reach us right ──
  const logoH = 40;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: MARGIN, y: y - logoH, width: logoW, height: logoH });
  } else {
    y -= 30;
    draw(t(data.businessName), MARGIN, 20, bold);
    y += 30;
  }
  y -= 16;
  drawRight(t(data.phone), PAGE_W - MARGIN, 14, bold);
  y -= 15;
  drawRight("Call or text", PAGE_W - MARGIN, 9.5, regular, MUTED);
  y -= 13;
  drawRight(t(data.website), PAGE_W - MARGIN, 9.5, regular, MUTED);
  y = PAGE_H - MARGIN - logoH - 18;
  rule(y);

  // ── Title and who it's for ──
  y -= 30;
  draw("Quote", MARGIN, 24, bold);
  drawRight(`Issued ${t(data.issuedOn)}`, PAGE_W - MARGIN, 10, regular, MUTED);
  // The second line's space is kept without a date so the block below doesn't ride up into the title.
  y -= 14;
  if (data.goodThrough) drawRight(`Good through ${t(data.goodThrough)}`, PAGE_W - MARGIN, 10, bold);
  y -= 14;
  draw("Prepared for", MARGIN, 9.5, regular, MUTED);
  paragraph(t(data.customerName), 12, bold);
  if (data.address) paragraph(t(data.address), 10.5, regular);
  if (data.service) paragraph(t(data.service), 10.5, regular, MUTED);

  // ── Priced rows: title (+ tag) left, amount right, description under ──
  const amountCol = 90;
  const priced = (rows: QuotePdfLine[]) => {
    for (const row of rows) {
      const titleLines = wrapText(t(row.title), bold, 11, CONTENT_W - amountCol - 8);
      const descLines = row.description ? wrapText(t(row.description), regular, 9.5, CONTENT_W - amountCol - 8) : [];
      room(titleLines.length * 15 + descLines.length * 13 + 24);
      y -= 16;
      drawRight(t(row.price), PAGE_W - MARGIN, 11, bold);
      titleLines.forEach((line, i) => {
        if (i) y -= 15;
        draw(line, MARGIN, 11, bold);
      });
      if (row.tag) {
        y -= 13;
        draw(t(row.tag), MARGIN, 8.5, bold, MUTED);
      }
      for (const line of descLines) {
        y -= 13;
        if (line) draw(line, MARGIN, 9.5, regular, MUTED);
      }
      y -= 7;
      rule(y);
    }
  };

  if (data.packages.length) {
    heading("Choose one");
    priced(data.packages);
  }
  if (data.lines.length) {
    heading(data.packages.length ? "Also on this quote" : "Line items");
    priced(data.lines);
  }

  // ── Total ──
  const note = data.totalNote ? wrapText(t(data.totalNote), regular, 9.5, CONTENT_W - 28) : [];
  const boxH = 44 + note.length * 13;
  room(boxH + 18);
  y -= 18;
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: SHADE });
  y -= 27;
  draw(t(data.totalLabel), MARGIN + 14, 12, bold);
  drawRight(t(data.total), PAGE_W - MARGIN - 14, 18, bold);
  for (const line of note) {
    y -= 13;
    draw(line, MARGIN + 14, 9.5, regular, MUTED);
  }
  y -= boxH - 27 - note.length * 13;

  // Beside the price, which is what they're deciding on.
  room(36);
  y -= 6;
  paragraph(t(data.linkLabel), 10, bold);
  paragraph(t(data.quoteUrl), 9.5, regular, MUTED);

  // ── What's included ──
  if (data.sections.length) {
    heading("What's included");
    for (const [label, body] of data.sections) {
      room(36);
      y -= 5;
      paragraph(t(label), 11, bold);
      paragraph(t(body), 10, regular);
    }
  }

  // ── Footer on every page ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 18 }, thickness: 0.75, color: RULE });
    const left = t(`${data.businessName}  |  ${data.phone}  |  ${data.website}`);
    p.drawText(left, { x: MARGIN, y: MARGIN, size: 8.5, font: regular, color: MUTED });
    if (pages.length > 1) {
      const n = `Page ${i + 1} of ${pages.length}`;
      p.drawText(n, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(n, 8.5), y: MARGIN, size: 8.5, font: regular, color: MUTED });
    }
  });

  return doc.save();
}

