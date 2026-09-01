import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { listAllAgreements, listQuotes, listStaff } from "@/lib/crm/queries";
import { AgreementStatusBadge } from "./agreement-list";

export const dynamic = "force-dynamic";

function fmt(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: BUSINESS_TZ,
  });
}

export default async function AgreementsPage() {
  const session = await requireSession();
  const base = await crmBase();
  const isOwner = session.staff.role === "owner";
  const rawLocale = session.staff.locale;
  const locale = isLocale(rawLocale) ? rawLocale : "en";
  const t = dict(locale);

  // RLS already scopes these: a contractor only sees their own agreement and the
  // jobs assigned to them, so this page works for both roles unchanged.
  const agreements = await listAllAgreements(session);
  const staff = await listStaff(session);
  const quotes = await listQuotes(session);

  const staffNames = new Map(staff.map((s) => [s.id, s.full_name || s.email || "Contractor"]));
  const quoteNames = new Map(quotes.map((q) => [q.id, q.name]));

  const counts = agreements.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const outstanding = (counts.pending ?? 0) + (counts.sent ?? 0);

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <div>
          <h1>{t.agreements.title}</h1>
          <p className="crm-muted">{t.agreements.subtitle}</p>
        </div>
      </div>

      <div className="crm-stats">
        <div className="crm-stat">
          <span>{t.agreements.total}</span>
          <strong>{agreements.length}</strong>
        </div>
        <div className="crm-stat">
          <span>{t.agreements.signed}</span>
          <strong>{counts.signed ?? 0}</strong>
        </div>
        <div className="crm-stat">
          <span>{t.agreements.outstanding}</span>
          <strong>{outstanding}</strong>
        </div>
      </div>

      <div className="crm-card">
        <h2 className="crm-card-title">
          {t.agreements.all} ({agreements.length})
        </h2>
        {agreements.length === 0 ? (
          <p className="crm-muted">{t.agreements.none}</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>{t.agreements.titleCol}</th>
                  <th>{t.agreements.typeCol}</th>
                  <th>{t.agreements.whoCol}</th>
                  <th>{t.agreements.statusCol}</th>
                  <th>{t.agreements.addedCol}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => {
                  const who =
                    a.kind === "contractor"
                      ? staffNames.get(a.staff_id ?? "") ?? t.agreements.contractor
                      : quoteNames.get(a.quote_id ?? "") ?? t.agreements.customer;
                  return (
                    <tr key={a.id}>
                      <td>{a.title}</td>
                      <td>{a.kind === "contractor" ? t.agreements.contractor : t.agreements.customer}</td>
                      <td>
                        {a.kind === "customer" && a.quote_id ? (
                          <Link href={`${base}/quotes/${a.quote_id}`} className="crm-link-strong">
                            {who}
                          </Link>
                        ) : (
                          who
                        )}
                      </td>
                      <td>
                        <AgreementStatusBadge status={a.status} locale={locale} />
                      </td>
                      <td>{fmt(a.created_at, locale)}</td>
                      <td className="crm-row-actions">
                        {a.file_path && (
                          <a
                            className="crm-btn crm-btn-ghost"
                            href={`/crm/api/agreement?id=${encodeURIComponent(a.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.agreements.viewFile}
                          </a>
                        )}
                        {a.docuseal_url && (
                          <a className="crm-btn crm-btn-ghost" href={a.docuseal_url} target="_blank" rel="noreferrer">
                            {t.agreements.openDocuseal}
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOwner && (
        <p className="crm-muted crm-sm">
          <Link href={`${base}/contractors`}>{t.nav.contractors}</Link> · {t.agreements.ownerHint}
        </p>
      )}
    </main>
  );
}
