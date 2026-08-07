import { requireOwner } from "@/lib/crm/auth";
import { STATUS_LABELS } from "@/lib/crm/constants";
import { crmBase } from "@/lib/crm/nav";
import { listQuotes } from "@/lib/crm/queries";
import { restoreQuoteForm } from "../board-actions";

export const dynamic = "force-dynamic";

export default async function ArchivedPage() {
  const session = await requireOwner();
  const base = await crmBase();

  const quotes = await listQuotes(session, { archived: true });

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <div>
          <h1>Archived</h1>
          <p className="crm-muted">
            {quotes.length} deleted {quotes.length === 1 ? "lead" : "leads"} · nothing here is ever removed from the
            database - restore a lead to bring it back to the pipeline.
          </p>
        </div>
      </div>

      {quotes.length === 0 ? (
        <div className="crm-empty">No deleted leads. Anything you delete from the pipeline shows up here.</div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Service</th>
                <th>Status when deleted</th>
                <th>Deleted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td className="crm-link-strong">{q.name}</td>
                  <td className="crm-sm">
                    {q.phone}
                    {q.email && <div className="crm-muted">{q.email}</div>}
                  </td>
                  <td>{q.service || "N/A"}</td>
                  <td>
                    <span className={`crm-badge crm-badge-${q.status}`}>{STATUS_LABELS[q.status]}</span>
                  </td>
                  <td className="crm-sm crm-muted">
                    {q.archived_at ? new Date(q.archived_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  </td>
                  <td className="crm-row-actions">
                    <form action={restoreQuoteForm}>
                      <input type="hidden" name="id" value={q.id} />
                      <button type="submit" className="crm-btn crm-btn-ghost">
                        Restore
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
