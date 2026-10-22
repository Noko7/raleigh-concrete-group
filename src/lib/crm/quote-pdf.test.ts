// The quote PDF carries text customers and staff typed. These pin down that
// such text only ever lands as drawn text: it can't break the font, and the
// file never gains anything a PDF reader would act on (scripts, auto-run
// actions, launches, links).
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { fitQuotePdf, pdfText, unwrapLines, wrapText, type QuotePdfData } from "./quote-pdf.ts";

const buildQuotePdf = async (d: QuotePdfData, logo: Uint8Array | null) => (await fitQuotePdf(d, logo)).pdf;

const base: QuotePdfData = {
  businessName: "Raleigh Concrete Group",
  phone: "(919) 873-3919",
  website: "raleighconcrete.net",
  customerName: "Pat Example",
  address: "123 Main St, Raleigh",
  service: "Concrete driveway",
  issuedOn: "October 22, 2026",
  goodThrough: "November 21, 2026",
  sections: [["Scope", "Tear out and replace the driveway."]],
  packages: [],
  lines: [],
  totalLabel: "Your price, all in",
  total: "$8,400",
  totalNote: null,
  linkLabel: "Ready to go ahead? Approve your quote online:",
  quoteUrl: "https://raleighconcrete.net/q/0123456789abcdef",
};

// The raw file with every compressed stream inflated, so a check can't miss
// something just because it was deflated.
function plainBytes(pdf: Uint8Array): string {
  const raw = Buffer.from(pdf).toString("latin1");
  let out = raw;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    try {
      out += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // Not deflated (or the PNG's own data); left as it is.
    }
  }
  return out;
}

const ACTIVE = ["/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/URI", "/SubmitForm", "/EmbeddedFile", "/RichMedia", "/AcroForm"];

test("pdfText keeps WinAnsi, folds accents it lacks, drops emoji and control characters", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cs = new Set(font.getCharacterSet());
  assert.equal(pdfText("José’s “patio” – 12×14", cs), "José’s “patio” – 12×14");
  assert.equal(pdfText("Erdős 🚧 slab", cs), "Erdos  slab");
  assert.equal(pdfText("a\u0000b\u0007c‮d\r\ne\tf", cs), "abcd\ne f");
});

test("wrapText fits every line to the width, splitting a word that can't fit", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = wrapText(`short words then ${"x".repeat(300)}\n\nnext`, font, 10, 200);
  for (const l of lines) assert.ok(font.widthOfTextAtSize(l, 10) <= 200, l);
  assert.ok(lines.includes(""), "blank line kept");
  assert.equal(lines.at(-1), "next");
});

test("hostile text renders as text and adds nothing a reader would run", async () => {
  const nasty = [
    "<script>alert(1)</script>",
    ") Tj /JavaScript (app.alert(1)) /S /JavaScript >> /OpenAction 1 0 R (",
    "\\) /Launch /F (cmd.exe) \\",
    "endstream endobj 9 0 obj << /Type /Action /URI (http://evil.example) >>",
    "${process.exit(1)} `rm -rf /` ../../etc/passwd",
    "🚧\u0000‮￿",
  ].join("\n");
  const pdf = await buildQuotePdf(
    {
      ...base,
      customerName: nasty,
      address: nasty,
      service: nasty,
      sections: [[nasty, nasty]],
      packages: [{ title: nasty, description: nasty, price: "$1", tag: "Recommended" }],
      lines: [{ title: nasty, description: nasty, price: "$2", tag: "Optional" }],
      totalNote: nasty,
    },
    null,
  );
  const body = plainBytes(pdf);
  // Typed text is drawn as hex strings, so none of it survives as PDF syntax.
  for (const key of ACTIVE) assert.ok(!new RegExp(`${key.replace("/", "\\/")}\\b`).test(body), `found ${key}`);
  // And it still opens.
  const reread = await PDFDocument.load(pdf);
  assert.ok(reread.getPageCount() >= 1);
});

test("pasted hard-wrapped text rejoins; real line breaks stay", () => {
  assert.deepEqual(unwrapLines("Clean the work area, and dress the patio\nedges"), ["Clean the work area, and dress the patio edges"]);
  assert.deepEqual(unwrapLines("• Sweep\npremium sand.\n• Next item"), ["• Sweep premium sand.", "• Next item"]);
  assert.deepEqual(unwrapLines("Section 1:\n- Cut the slope\nForm each section"), ["Section 1:", "- Cut the slope", "Form each section"]);
  assert.deepEqual(unwrapLines("Total Area: 440\n\nnext para"), ["Total Area: 440", "", "next para"]);
});

// Real quotes run from "Not applicable" in four sections to ~5,000 characters
// of bullet lists, so both ends are pinned: a sparse quote at full size on one
// page, a middling one shrunk onto one page, a huge one at full size over two.
const words = (n: number) => Array.from({ length: n }, (_, i) => `* Compact and grade the base, line ${i}, to a firm and stable surface.`).join("\n");

test("a sparse quote is one page at full size", async () => {
  const r = await fitQuotePdf({ ...base, sections: [["Scope", "Remove existing patio."], ["Permits", "Not applicable"]] }, null);
  assert.deepEqual([r.pages, r.scale], [1, 1]);
});

test("a quote a little too long for one page shrinks onto one", async () => {
  const r = await fitQuotePdf({ ...base, sections: [["Scope", words(40)]] }, null);
  assert.equal(r.pages, 1);
  assert.ok(r.scale < 1);
});

test("a quote far too long for one page runs over at full size", async () => {
  const r = await fitQuotePdf({ ...base, sections: [["Scope", words(90)]] }, null);
  assert.ok(r.pages >= 2);
  assert.equal(r.scale, 1);
});

test("a long quote flows onto more pages instead of running off the bottom", async () => {
  const long = "Forms set, base compacted and graded, rebar on chairs. ".repeat(40);
  const pdf = await buildQuotePdf(
    {
      ...base,
      sections: Array.from({ length: 8 }, (_, i) => [`Section ${i}`, long] as const),
      lines: Array.from({ length: 30 }, (_, i) => ({ title: `Item ${i}`, description: long.slice(0, 200), price: "$100", tag: null })),
    },
    null,
  );
  assert.ok((await PDFDocument.load(pdf)).getPageCount() > 2);
});

test("the real logo embeds", async () => {
  const png = new Uint8Array(readFileSync(new URL("../../../public/images/logo_horizontal.png", import.meta.url)));
  const pdf = await buildQuotePdf(base, png);
  assert.ok(plainBytes(pdf).includes("/Subtype /Image"));
});

test("a copy without the customer link still lays out on one page", async () => {
  const r = await fitQuotePdf({ ...base, quoteUrl: null }, null);
  assert.deepEqual([r.pages, r.scale], [1, 1]);
});

test("a broken logo falls back to the name in text", async () => {
  const pdf = await buildQuotePdf(base, new Uint8Array([1, 2, 3]));
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
});
