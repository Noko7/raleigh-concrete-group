import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import { listAllAgreements, listQuotes, listStaff } from "@/lib/crm/queries";
import { AgreementStatusBadge } from "./agreement-list";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AgreementsPage() {
  const session = await requireSession();
  const base = await crmBase();
  const isOwner = session.staff.role === "owner";

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
          <h1>Agreements</h1>
          <p className="crm-muted">
            Every contract you track, for contractors and for jobs. Signing happens in DocuSeal; this is the record.
          </p>
        </div>
      </div>

      <div className="crm-stats">
        <div className="crm-stat">
          <span>Total</span>
          <strong>{agreements.length}</strong>
        </div>
        <div className="crm-stat">
          <span>Signed</span>
          <strong>{counts.signed ?? 0}</strong>
        </div>
        <div className="crm-stat">
          <span>Outstanding</span>
          <strong>{outstanding}</strong>
        </div>
      </div>

      <div className="crm-card">
        <h2 className="crm-card-title">All agreements ({agreements.length})</h2>
        {agreements.length === 0 ? (
          <p className="crm-muted">
            Nothing tracked yet. Add a contractor agreement from the Contractors page, or a customer agreement from a
            job.
          </p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Who</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => {
                  const who =
                    a.kind === "contractor"
                      ? staffNames.get(a.staff_id ?? "") ?? "Contractor"
                      : quoteNames.get(a.quote_id ?? "") ?? "Customer";
                  return (
                    <tr key={a.id}>
                      <td>{a.title}</td>
                      <td>{a.kind === "contractor" ? "Contractor" : "Customer"}</td>
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
                        <AgreementStatusBadge status={a.status} />
                      </td>
                      <td>{fmt(a.created_at)}</td>
                      <td className="crm-row-actions">
                        {a.file_path && (
                          <a
                            className="crm-btn crm-btn-ghost"
                            href={`/crm/api/agreement?id=${encodeURIComponent(a.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            File
                          </a>
                        )}
                        {a.docuseal_url && (
                          <a className="crm-btn crm-btn-ghost" href={a.docuseal_url} target="_blank" rel="noreferrer">
                            DocuSeal
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
          Add a contractor agreement on the <Link href={`${base}/contractors`}>Contractors</Link> page, or a customer
          agreement from that job&apos;s page.
        </p>
      )}
    </main>
  );
}
