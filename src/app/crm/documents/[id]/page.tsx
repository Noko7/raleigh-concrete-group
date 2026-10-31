import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { jobLedger } from "@/lib/crm/payments";
import { getQuote, listAgreementsForQuote } from "@/lib/crm/queries";
import { listReceiptsForJob, receiptRowsFor } from "@/lib/crm/receipts";
import { JobReceipts } from "@/app/crm/quotes/[id]/job-receipts";
import { CLOSED_FOR_EDITS, canEditJobAgreement, editableAgreement, getVersion, listVersions } from "@/lib/crm/agreement-versions";
import { parseBody } from "@/lib/crm/agreement-doc";
import type { Agreement } from "@/lib/crm/types";
import { AddAgreement } from "../add-agreement";
import { AgreementList } from "../agreement-list";
import { AgreementEditor } from "./agreement-editor";
import { EarlierAgreements } from "./earlier-agreements";
import { SigningPanel, type SigningView } from "./signing-panel";
import { reconcileWithDocuseal, signingFor, signLink, type SigningSecrets } from "@/lib/crm/agreement-signing";
import { docusealConfigured } from "@/lib/crm/docuseal";
import { SENDABLE, type AgreementSigningStatus } from "@/lib/crm/docuseal-core";
import { RestartAgreement, StartAgreement } from "./start-agreement";
import { templateChoices } from "@/lib/crm/templates";

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
  const [firstRead, receipts, money] = await Promise.all([
    listAgreementsForQuote(session, id),
    listReceiptsForJob(session, id),
    // Only to find paid payments with no receipt, which only the owner can fix.
    isOwner && quote.quote_amount != null ? jobLedger(quote) : Promise.resolve(null),
  ]);
  // The agreement written in the CRM (versioned) leads; files uploaded by hand are listed apart.
  const canEdit = canEditJobAgreement(session, quote);
  let agreements = firstRead;
  // A missed webhook or a signed copy that didn't reach storage is caught up from DocuSeal on each visit.
  const first = editableAgreement(agreements);
  if (first && (await reconcileWithDocuseal(first))) agreements = await listAgreementsForQuote(session, id);
  const current = editableAgreement(agreements);
  const others = agreements.filter((a) => a.id !== current?.id && !a.current_version_id);
  // What lets people sign is server-only: the contractor who was sent it gets their own link; only the owner sees
  // the customer's.
  const found = current?.docuseal_submission_id ? await signingFor(current.id).catch(() => null) : null;
  const links = found && found.submission_id === current?.docuseal_submission_id ? found : null;
  // Agreements written in the CRM and set aside to start over: read-only, with their history.
  const earlier = agreements.filter((a) => a.id !== current?.id && a.current_version_id);
  const [versions, currentVersion, earlierVersions, picker] = await Promise.all([
    current?.current_version_id ? listVersions(session, current.id) : Promise.resolve([]),
    current?.current_version_id ? getVersion(session, current.current_version_id) : Promise.resolve(null),
    Promise.all(earlier.map((a) => listVersions(session, a.id))),
    canEdit ? templateChoices(quote.service) : Promise.resolve({ choices: [], defaultId: null }),
  ]);
  // Read through parseBody: a version saved before templates existed gets the built-in template.
  const currentBody = currentVersion ? parseBody(currentVersion.body) : null;
  // A stored version that can't be read is shown as an error, never replaced by "Write the agreement".
  const unreadable = Boolean(current && currentVersion && !currentBody);
  if (unreadable) console.error("[agreements] stored version doesn't parse", current?.id, currentVersion?.id);
  const canRestart = Boolean(
    canEdit && current && !unreadable && !quote.change_requested_at && ["pending", "declined", "expired"].includes(current.status),
  );
  const liveReceiptFor = new Set(receipts.filter((r) => !r.voided_at).map((r) => r.payment_id));
  const missing = money
    ? money.rows
        .filter((r) => r.status === "paid" && !liveReceiptFor.has(r.id))
        .map((r) => ({ paymentId: r.id, amount_cents: r.amount_cents, method: r.method, paid_at: r.paid_at ?? r.created_at }))
    : [];

  const jobHref = isOwner ? `${base}/quotes/${quote.id}` : `/job/${quote.job_token}`;
  const where = [quote.address, quote.city].filter(Boolean).join(", ");

  return (
    <main className="crm-page crm-page-wide crm-page-full">
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

      {current && current.sent_at && current.status !== "pending" && (
        <SigningPanel quoteId={quote.id} view={signingView(current, versions, links, { isOwner, staffId: session.staff.id })} isContractor={Boolean(links && session.staff.id === links.contractor_staff_id)} isOwner={isOwner} />
      )}

      {current && currentBody ? (
        <AgreementEditor
          quoteId={quote.id}
          agreementId={current.id}
          initial={currentBody}
          versions={versions}
          canEdit={canEdit}
          closed={CLOSED_FOR_EDITS.includes(current.status)}
          canSend={canEdit && docusealConfigured() && SENDABLE.includes(current.status as AgreementSigningStatus)}
        />
      ) : unreadable ? (
        <section className="crm-card" aria-label="Customer agreement">
          <h2 className="crm-card-title">Customer agreement</h2>
          <p className="jr-err" role="alert">
            This agreement&apos;s saved version couldn&apos;t be read, so it can&apos;t be shown or edited here. Nothing has been
            changed. Contact support before writing a new one.
          </p>
        </section>
      ) : (
        <section className="crm-card" aria-label="Customer agreement">
          <h2 className="crm-card-title">Customer agreement</h2>
          {canEdit ? (
            <StartAgreement quoteId={quote.id} choices={picker.choices} defaultId={picker.defaultId} />
          ) : (
            <p className="crm-muted crm-sm">No agreement written yet.</p>
          )}
        </section>
      )}
      {canRestart && current && (
        <div className="ae-restart-row">
          <RestartAgreement quoteId={quote.id} agreementId={current.id} choices={picker.choices} defaultId={picker.defaultId} />
        </div>
      )}
      <EarlierAgreements
        items={earlier.map((a, i) => ({ id: a.id, title: a.title, status: a.status, created_at: a.created_at, versions: earlierVersions[i] ?? [] }))}
      />

      {(others.length > 0 || isOwner) && (
        <section className="crm-card" aria-label="Agreement files">
          <h2 className="crm-card-title">Signed on paper or elsewhere</h2>
          <p className="crm-muted crm-sm">Agreements kept as a file, with their status set by hand.</p>
          <AgreementList agreements={others} isOwner={isOwner} locale={locale} />
          {isOwner && (
            <div className="ag-add">
              <AddAgreement kind="customer" targetId={quote.id} defaultTitle={`Customer agreement for ${quote.name}`} />
            </div>
          )}
        </section>
      )}

      <JobReceipts quoteId={quote.id} locale={locale} receipts={receiptRowsFor(receipts)} missing={missing} />
    </main>
  );
}

function signingView(
  a: Agreement,
  versions: { id: string; version_no: number }[],
  links: SigningSecrets | null,
  viewer: { isOwner: boolean; staffId: string },
): SigningView {
  const mine = links && viewer.staffId === links.contractor_staff_id;
  return {
    status: a.status,
    versionNo: versions.find((v) => v.id === a.sent_version_id)?.version_no ?? null,
    sentAt: a.sent_at,
    contractorSignedAt: a.contractor_signed_at ?? null,
    signedAt: a.completed_at ?? a.signed_at,
    expiresAt: a.expires_at ?? null,
    declineReason: a.decline_reason ?? null,
    contractorEmbed: mine ? (links.signers.find((s) => s.role === "Contractor")?.embed_src ?? null) : null,
    customerLink: viewer.isOwner && links ? signLink(links.sign_token) : null,
    customerTexted: Boolean(links?.customer_texted_at),
    hasPdf: Boolean(a.signed_pdf_path && a.file_path),
    hasAudit: Boolean(a.audit_log_path),
    agreementId: a.id,
  };
}
