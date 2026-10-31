import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { BUSINESS_TZ } from "@/lib/crm/clock";
import { groupByJob } from "@/lib/crm/documents";
import { isLocale, type Locale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { getJobHeads, listAllAgreements, listStaff } from "@/lib/crm/queries";
import { receiptMoney } from "@/lib/crm/receipt-format";
import { listReceiptsForHub } from "@/lib/crm/receipts";
import { AddAgreement } from "./add-agreement";
import { AgreementList, AgreementStatusBadge } from "./agreement-list";
import { ReceiptsView } from "./receipts-view";

export const dynamic = "force-dynamic";

// Every document in one place: customer agreements and receipts grouped by job, the books' receipts by year,
// and contractor onboarding agreements. RLS scopes all of it, so a contractor sees their own jobs and their own
// agreement, and the owner sees everything. Job pages link here instead of listing documents themselves.
type View = "jobs" | "receipts" | "contractors";

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: BUSINESS_TZ });
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; year?: string; tests?: string }>;
}) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const isOwner = session.staff.role === "owner";
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const view: View = sp.view === "receipts" || sp.view === "contractors" ? sp.view : "jobs";
  const includeTests = sp.tests === "1";

  const tabs: { key: View; label: string }[] = [
    { key: "jobs", label: "By job" },
    { key: "receipts", label: "Receipts" },
    { key: "contractors", label: isOwner ? "Contractor agreements" : "My agreement" },
  ];

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Documents</h1>
          <p className="crm-muted crm-sm">Agreements and receipts, kept together by job.</p>
        </div>
      </div>

      <nav className="dh-tabs" aria-label="Documents">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${base}/documents${t.key === "jobs" ? "" : `?view=${t.key}`}`}
            className={t.key === view ? "rl-year rl-year-on" : "rl-year"}
            aria-current={t.key === view ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {view === "receipts" && <ReceiptsView session={session} base={base} yearParam={sp.year} tests={sp.tests} />}
      {view === "jobs" && <JobsView base={base} includeTests={includeTests} session={session} />}
      {view === "contractors" && <ContractorsView isOwner={isOwner} locale={locale} session={session} />}
    </main>
  );
}

async function JobsView({
  session,
  base,
  includeTests,
}: {
  session: Awaited<ReturnType<typeof requireSession>>;
  base: string;
  includeTests: boolean;
}) {
  const [agreements, receipts, staff] = await Promise.all([
    listAllAgreements(session),
    listReceiptsForHub(session),
    listStaff(session),
  ]);
  const grouped = groupByJob(agreements, receipts.rows);
  const heads = await getJobHeads(
    session,
    grouped.map((g) => g.quoteId),
  );
  const staffName = new Map(staff.map((s) => [s.id, s.business_name || s.full_name || s.email || "Contractor"]));
  // A job RLS hides (unassigned since) is left out rather than shown nameless.
  const visible = grouped.filter((g) => heads.has(g.quoteId));
  const testCount = visible.filter((g) => heads.get(g.quoteId)?.is_test).length;
  const jobs = includeTests ? visible : visible.filter((g) => !heads.get(g.quoteId)?.is_test);

  return (
    <>
      {!receipts.ok && <p className="crm-auth-error">Some receipts couldn&apos;t be loaded. Refresh before relying on this list.</p>}
      {testCount > 0 && (
        <p className="crm-muted crm-sm">
          {includeTests ? (
            <>
              Practice jobs are <strong>in</strong> this list. <Link href={`${base}/documents`}>Hide them</Link>
            </>
          ) : (
            <>
              {testCount} practice {testCount === 1 ? "job is" : "jobs are"} left out.{" "}
              <Link href={`${base}/documents?tests=1`}>Show them</Link>
            </>
          )}
        </p>
      )}

      {jobs.length === 0 ? (
        <p className="crm-muted">No documents yet. A receipt appears here the moment a payment is recorded.</p>
      ) : (
        <ul className="dh-jobs">
          {jobs.map((g) => {
            const q = heads.get(g.quoteId)!;
            const where = [q.address, q.city].filter(Boolean).join(", ");
            return (
              <li key={g.quoteId}>
                <Link href={`${base}/documents/${g.quoteId}`} className="dh-job">
                  <span className="dh-job-name">
                    {q.name}
                    {q.is_test && <span className="rl-tag">Practice</span>}
                    {q.archived_at && <span className="rl-tag">Archived</span>}
                  </span>
                  <span className="dh-job-meta">
                    {[q.service, where, q.assigned_to ? staffName.get(q.assigned_to) : null].filter(Boolean).join(" · ")}
                  </span>
                  <span className="dh-chips">
                    {g.agreement ? (
                      <AgreementStatusBadge status={g.agreement} />
                    ) : (
                      <span className="crm-badge dh-chip-none">No agreement</span>
                    )}
                    {g.receipts > 0 && (
                      <span className="crm-badge dh-chip">
                        {g.receipts} {g.receipts === 1 ? "receipt" : "receipts"} · {receiptMoney(g.receivedCents)}
                      </span>
                    )}
                    {g.lastActivity && <span className="dh-when">{day(g.lastActivity)}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

async function ContractorsView({
  session,
  isOwner,
  locale,
}: {
  session: Awaited<ReturnType<typeof requireSession>>;
  isOwner: boolean;
  locale: Locale;
}) {
  const [agreements, staff] = await Promise.all([listAllAgreements(session), listStaff(session)]);
  const onboarding = agreements.filter((a) => a.kind === "contractor");

  if (!isOwner) {
    const mine = onboarding.filter((a) => a.staff_id === session.staff.id);
    return <AgreementList agreements={mine} isOwner={false} locale={locale} />;
  }

  const contractors = staff.filter((s) => s.role === "contractor");
  return (
    <>
      <p className="crm-muted crm-sm">
        One signed agreement per crew member. Contractors can view their own agreement but can&apos;t change its status.
      </p>
      {contractors.length === 0 ? (
        <p className="crm-muted">No contractors yet.</p>
      ) : (
        <div className="ag-groups">
          {contractors.map((c) => (
            <div key={c.id} className="ag-group">
              <div className="ag-group-head">
                <strong>{c.full_name || c.email || "Contractor"}</strong>
                {!c.active && <span className="rl-tag">Inactive</span>}
              </div>
              <AgreementList agreements={onboarding.filter((a) => a.staff_id === c.id)} isOwner />
              <div className="ag-add">
                <AddAgreement
                  kind="contractor"
                  targetId={c.id}
                  defaultTitle={`Contractor agreement for ${c.full_name || c.email || "Contractor"}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
