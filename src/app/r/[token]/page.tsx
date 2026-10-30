import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { receiptByToken } from "@/lib/crm/receipts";
import { pgAdmin } from "@/lib/crm/rest";
import { ReceiptView } from "./receipt-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Payment receipt | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

// A payment receipt, as issued: everything here comes from the receipt's own frozen copy, never from the job
// as it is now. The link is the receipt (the token is the only key), the same way a quote link works. The
// staff's internal payment note is never shown here; it is in the owner's export.
export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await receiptByToken(token);
  if (!r) notFound();

  // The other half of a void-and-reissue, so either page leads to the right one.
  const linkedIds = [r.replaces_receipt_id, r.replaced_by_receipt_id].filter((v): v is string => Boolean(v));
  const linked = new Map<string, { receipt_number: number; token: string }>();
  if (linkedIds.length) {
    const res = await pgAdmin(`payment_receipts?id=in.(${linkedIds.join(",")})&select=id,receipt_number,token`);
    if (res.ok) for (const x of (await res.json()) as { id: string; receipt_number: number; token: string }[]) linked.set(x.id, x);
  }
  const replaces = r.replaces_receipt_id ? linked.get(r.replaces_receipt_id) : undefined;
  const replacedBy = r.replaced_by_receipt_id ? linked.get(r.replaced_by_receipt_id) : undefined;
  return <ReceiptView r={r} replaces={replaces} replacedBy={replacedBy} />;
}
