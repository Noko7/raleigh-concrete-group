import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/crm/env";
import { crmBase } from "@/lib/crm/nav";
import { listQuotes, listStaff, staffNameMap } from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

type SP = { status?: string; assignedTo?: string; search?: string };

function StatusBadge({ status }: { status: Status }) {
  return <span className={`crm-badge crm-badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function CrmDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const isOwner = session.staff.role === "owner";

  const quotes = await listQuotes(session, {
    status: STATUSES.includes(sp.status as Status) ? sp.status : undefined,
    assignedTo: sp.assignedTo,
    search: sp.search,
  });
  const staff = await listStaff(session);
  const nameMap = staffNameMap(staff);
  const contractors = staff.filter((s) => s.role === "contractor");

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <h1>Quotes</h1>
        <p className="crm-muted">
          {quotes.length} {quotes.length === 1 ? "quote" : "quotes"}
          {isOwner ? "" : " assigned to you"}
        </p>
      </div>

      <form className="crm-filters" method="get" action={`${base}/`}>
        <input className="crm-input" type="search" name="search" placeholder="Search name, phone, address…" defaultValue={sp.search ?? ""} />
        <select className="crm-input" name="status" defaultValue={sp.status ?? ""}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {isOwner && (
          <select className="crm-input" name="assignedTo" defaultValue={sp.assignedTo ?? ""}>
            <option value="">Any assignee</option>
            <option value="unassigned">Unassigned</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="crm-btn crm-btn-primary">
          Filter
        </button>
        <Link href={`${base}/`} className="crm-btn crm-btn-ghost">
          Reset
        </Link>
      </form>

      {quotes.length === 0 ? (
        <div className="crm-empty">No quotes match these filters yet.</div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Service</th>
                <th>Location</th>
                <th>Type</th>
                <th>Status</th>
                <th>Assigned</th>
                <th>Views</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link href={`${base}/quotes/${q.id}`} className="crm-link-strong">
                      {q.name}
                    </Link>
                    <div className="crm-muted crm-sm">{q.phone}</div>
                  </td>
                  <td>{q.service || "—"}</td>
                  <td>{q.city || "—"}</td>
                  <td>{q.quote_type === "online" ? "Online" : q.quote_type === "inperson" ? "In-person" : "—"}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td>{q.assigned_to ? nameMap.get(q.assigned_to) ?? "—" : <span className="crm-muted">Unassigned</span>}</td>
                  <td>{q.view_count > 0 ? q.view_count : <span className="crm-muted">0</span>}</td>
                  <td className="crm-muted crm-sm">{fmtDate(q.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
