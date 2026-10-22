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
const MARGIN = 48;
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

// Smallest the text may shrink to keep a quote on one page: body copy lands
// near 8pt, still easy to read on paper. Past that it runs onto a second page
// at full size instead, since a squeezed wall of text helps nobody.
const FIT_SCALES = [1, 0.93, 0.86, 0.8];

/** One page whenever shrinking the type a little gets it there; otherwise full size over as many as it needs. */
export async function buildQuotePdf(data: QuotePdfData, logoPng: Uint8Array | null): Promise<Uint8Array> {
  return (await fitQuotePdf(data, logoPng)).pdf;
}

/** buildQuotePdf, also saying what it settled on. */
export async function fitQuotePdf(
  data: QuotePdfData,
  logoPng: Uint8Array | null,
): Promise<{ pdf: Uint8Array; scale: number; pages: number }> {
  for (const scale of FIT_SCALES) {
    const doc = await layout(data, logoPng, scale);
    if (doc.getPageCount() === 1) return { pdf: await doc.save(), scale, pages: 1 };
  }
  const doc = await layout(data, logoPng, 1);
  return { pdf: await doc.save(), scale: 1, pages: doc.getPageCount() };
}

/**
 * Lines as the reader should see them. Text pasted from another document
 * arrives hard-wrapped ("...dress the patio\nedges"); a line that starts in
 * lower case after one that didn't end a sentence is the same sentence, so it
 * rejoins. Real line breaks (lists, "Section 1:", short lines) are kept.
 */
export function unwrapLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out.at(-1);
    if (prev?.trim() && /^\s*[a-z]/.test(line) && !/[.:;!?]\s*$/.test(prev)) {
      out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    } else out.push(line);
  }
  return out;
}

// A list item as typed: "* x", "- x", "• x", "1. x" or "1) x".
const BULLET = /^\s*(?:([*•\-–])|(\d{1,2}[.)]))\s+(.*)$/;

async function layout(data: QuotePdfData, logoPng: Uint8Array | null, scale: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.businessName} quote for ${data.customerName}`);
  doc.setAuthor(data.businessName);
  doc.setCreator(data.businessName);
  doc.setProducer(data.businessName);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  const t = (s: string | null | undefined) => pdfText(s ?? "", charset);
  // Sizes and gaps for the body of the quote. The header and footer stay fixed:
  // the brand reads the same however much the contractor wrote.
  const k = (n: number) => n * scale;

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
  // Typed text at x, width wide: list items get a bullet and a hanging indent,
  // and a run of blank lines shrinks to one short gap. `first` runs on the
  // first line drawn, so a label beside the text lands on the same page.
  const block = (text: string, x: number, width: number, size: number, color = INK, first?: () => void) => {
    const lh = size * 1.32;
    let gap = false;
    let started = false;
    const line = () => {
      room(lh);
      y -= lh;
      started = true;
      if (first) {
        first();
        first = undefined;
      }
    };
    for (const raw of unwrapLines(t(text))) {
      if (!raw.trim()) {
        if (!gap && started) y -= lh * 0.45;
        gap = true;
        continue;
      }
      gap = false;
      const m = BULLET.exec(raw);
      if (m) {
        const marker = m[1] ? "•" : m[2];
        const indent = Math.max(size * 1.1, regular.widthOfTextAtSize(`${marker} `, size));
        wrapText(m[3], regular, size, width - indent).forEach((l, i) => {
          line();
          if (!i) draw(marker, x, size, regular, color);
          draw(l, x + indent, size, regular, color);
        });
      } else {
        for (const l of wrapText(raw.trim(), regular, size, width)) {
          line();
          draw(l, x, size, regular, color);
        }
      }
    }
  };
  const heading = (s: string) => {
    room(k(44));
    y -= k(20);
    draw(t(s).toUpperCase(), MARGIN, k(9), bold, MUTED);
    y -= k(7);
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
  y -= k(30);
  draw("Quote", MARGIN, k(24), bold);
  drawRight(`Issued ${t(data.issuedOn)}`, PAGE_W - MARGIN, k(10), regular, MUTED);
  // The second line's space is kept without a date so the block below doesn't ride up into the title.
  y -= k(14);
  if (data.goodThrough) drawRight(`Good through ${t(data.goodThrough)}`, PAGE_W - MARGIN, k(10), bold);
  y -= k(14);
  y -= k(6);
  const preparedFor = "Prepared for  ";
  const nameX = MARGIN + regular.widthOfTextAtSize(preparedFor, k(9));
  draw(preparedFor, MARGIN, k(9), regular, MUTED);
  wrapText(t(data.customerName), bold, k(12), CONTENT_W - (nameX - MARGIN)).forEach((l, i) => {
    if (i) y -= k(15);
    draw(l, nameX, k(12), bold);
  });
  const sub = [data.address, data.service].filter(Boolean).join("  |  ");
  if (sub) block(sub, MARGIN, CONTENT_W, k(10), MUTED);

  // ── Priced rows: title (+ tag) left, amount right, description under ──
  const textW = CONTENT_W - 100;
  const priced = (rows: QuotePdfLine[]) => {
    for (const row of rows) {
      const titleLines = wrapText(t(row.title), bold, k(11), textW);
      // The tag rides at the end of the title when there's room, else on its own line.
      const tag = row.tag ? t(row.tag).toUpperCase() : "";
      const tagGap = k(8);
      const lastW = bold.widthOfTextAtSize(titleLines.at(-1) ?? "", k(11));
      const tagInline = !tag || lastW + tagGap + bold.widthOfTextAtSize(tag, k(7.5)) <= textW;
      // Title, tag and first description line stay together; a long description may then run on.
      room(titleLines.length * k(15) + (tagInline ? 0 : k(12)) + k(13) + k(18));
      y -= k(16);
      drawRight(t(row.price), PAGE_W - MARGIN, k(11), bold);
      titleLines.forEach((l, i) => {
        if (i) y -= k(15);
        draw(l, MARGIN, k(11), bold);
      });
      if (tag && tagInline) draw(tag, MARGIN + lastW + tagGap, k(7.5), bold, MUTED);
      else if (tag) {
        y -= k(12);
        draw(tag, MARGIN, k(7.5), bold, MUTED);
      }
      if (row.description?.trim()) {
        y -= k(1);
        block(row.description, MARGIN, textW, k(9.5), MUTED);
      }
      y -= k(7);
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

  // ── Total, and how to say yes ──
  const innerW = CONTENT_W - 28;
  const note = data.totalNote ? wrapText(t(data.totalNote), regular, k(9), innerW) : [];
  // Label and link on one line when they fit, else the link under it.
  const linkLabel = `${t(data.linkLabel)} `;
  const url = t(data.quoteUrl);
  const linkW = bold.widthOfTextAtSize(linkLabel, k(9)) + regular.widthOfTextAtSize(url, k(9));
  const linkRows = linkW <= innerW ? 1 : 2;
  const boxH = k(40) + note.length * k(12) + k(8) + linkRows * k(12);
  room(boxH + k(16));
  y -= k(16);
  page.drawRectangle({ x: MARGIN, y: y - boxH, width: CONTENT_W, height: boxH, color: SHADE });
  const boxBottom = y - boxH;
  y -= k(25);
  draw(t(data.totalLabel), MARGIN + 14, k(12), bold);
  drawRight(t(data.total), PAGE_W - MARGIN - 14, k(18), bold);
  for (const l of note) {
    y -= k(12);
    draw(l, MARGIN + 14, k(9), regular, MUTED);
  }
  y -= k(20);
  draw(linkLabel, MARGIN + 14, k(9), bold);
  if (linkRows === 2) y -= k(12);
  draw(url, linkRows === 1 ? MARGIN + 14 + bold.widthOfTextAtSize(linkLabel, k(9)) : MARGIN + 14, k(9), regular, MUTED);
  y = boxBottom;

  // ── What's included: label column left, the contractor's words right ──
  if (data.sections.length) {
    heading("What's included");
    const labelW = 112;
    const bodyX = MARGIN + labelW;
    for (const [label, body] of data.sections) {
      y -= k(6);
      block(body, bodyX, CONTENT_W - labelW, k(9.5), INK, () => {
        wrapText(t(label), bold, k(9.5), labelW - 12).forEach((l, i) =>
          page.drawText(l, { x: MARGIN, y: y - i * k(13), size: k(9.5), font: bold, color: INK }),
        );
      });
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

  return doc;
}
