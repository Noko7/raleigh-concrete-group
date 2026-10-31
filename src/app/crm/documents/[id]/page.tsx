import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { jobLedger } from "@/lib/crm/payments";
import { getQuote, listAgreementsForQuote } from "@/lib/crm/queries";
import { listReceiptsForJob, receiptRowsFor } from "@/lib/crm/receipts";
import { JobReceipts } from "@/app/crm/quotes/[id]/job-receipts";
import { AddAgreement } from "../add-agreement";
import { AgreementList } from "../agreement-list";

export const dynamic = "force-dynamic";

// One job's documents: its customer agreement(s) and every receipt, each with the actions that belong to it.
// RLS decides who gets here: the owner, or the contractor assigned to the job.
export default async function JobDocuments({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const base = await crmBase();
  const { id } = await params;

  const quote = await getQuote(session, id);
  if (!quote) notFound();

  const isOwner = session.staff.role === "owner";
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const [agreements, receipts, money] = await Promise.all([
    listAgreementsForQuote(session, id),
    listReceiptsForJob(session, id),
    // Only to find paid payments with no receipt, which only the owner can fix.
    isOwner && quote.quote_amount != null ? jobLedger(quote) : Promise.resolve(null),
  ]);
  const liveReceiptFor = new Set(receipts.filter((r) => !r.voided_at).map((r) => r.payment_id));
  const missing = money
    ? money.rows
        .filter((r) => r.status === "paid" && !liveReceiptFor.has(r.id))
        .map((r) => ({ paymentId: r.id, amount_cents: r.amount_cents, method: r.method, paid_at: r.paid_at ?? r.created_at }))
    : [];

  const jobHref = isOwner ? `${base}/quotes/${quote.id}` : `/job/${quote.job_token}`;
  const where = [quote.address, quote.city].filter(Boolean).join(", ");

  return (
    <main className="crm-page">
      <div className="crm-breadcrumb">
        <Link href={`${base}/documents`}>← Documents</Link>
      </div>
      <div className="crm-page-head">
        <div>
          <h1>{quote.name}</h1>
          <p className="crm-muted crm-sm">
            {[quote.service, where].filter(Boolean).join(" · ")} · <Link href={jobHref}>Open the job →</Link>
          </p>
        </div>
      </div>

      <section className="crm-card" aria-label="Customer agreement">
        <h2 className="crm-card-title">Customer agreement</h2>
        <p className="crm-muted crm-sm">
          {quote.email
            ? `Signing happens in DocuSeal, which emails ${quote.email}.`
            : "This customer has no email on file, so DocuSeal can't email them. Share the signing link another way."}
        </p>
        <AgreementList agreements={agreements} isOwner={isOwner} locale={locale} />
        {isOwner && (
          <div className="ag-add">
            <AddAgreement kind="customer" targetId={quote.id} defaultTitle={`Customer agreement for ${quote.name}`} />
          </div>
        )}
      </section>

      <JobReceipts quoteId={quote.id} locale={locale} receipts={receiptRowsFor(receipts)} missing={missing} />
    </main>
  );
}
