import { readFile } from "node:fs/promises";
import path from "node:path";

import { SITE_ORIGIN } from "@/lib/crm/env";
import { buildReceiptPdf } from "@/lib/crm/receipt-pdf";
import { receiptNumberLabel } from "@/lib/crm/receipt-format";
import { receiptNumbersById, type PaymentReceipt } from "@/lib/crm/receipts";
import { businessName, phoneDisplay } from "@/lib/site-data";

// A fixed file, never a path built from the request. Bundled by outputFileTracingIncludes in next.config.ts.
const LOGO_PATH = path.join(process.cwd(), "public", "images", "logo_horizontal.png");
let logoBytes: Promise<Uint8Array | null> | null = null;
function logo(): Promise<Uint8Array | null> {
  logoBytes ??= readFile(LOGO_PATH).then(
    (b) => new Uint8Array(b),
    () => null,
  );
  return logoBytes;
}

/** A receipt as a PDF download. Whoever may see the receipt decides; this only draws it. */
export async function receiptPdfResponse(receipt: PaymentReceipt): Promise<Response> {
  const numbers = await receiptNumbersById([receipt.replaces_receipt_id, receipt.replaced_by_receipt_id]);
  const pdf = await buildReceiptPdf(
    {
      receipt,
      businessName,
      businessPhone: phoneDisplay,
      website: new URL(SITE_ORIGIN).host,
      replacesNumber: receipt.replaces_receipt_id ? (numbers.get(receipt.replaces_receipt_id) ?? null) : null,
      replacedByNumber: receipt.replaced_by_receipt_id ? (numbers.get(receipt.replaced_by_receipt_id) ?? null) : null,
    },
    await logo(),
  );
  const name = `receipt-${receiptNumberLabel(receipt.receipt_number).slice(1)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
