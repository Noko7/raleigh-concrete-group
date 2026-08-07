import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { crmBase } from "@/lib/crm/nav";
import { listQuotes, listStaff } from "@/lib/crm/queries";
import { KanbanBoard, type BoardQuote } from "./kanban-board";

export const dynamic = "force-dynamic";

type SP = { search?: string; assignedTo?: string };

export default async function CrmDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const isOwner = session.staff.role === "owner";

  const quotes = await listQuotes(session, { search: sp.search, assignedTo: sp.assignedTo });
  const staff = await listStaff(session);
  const contractors = staff.filter((s) => s.role === "contractor");
  const nameMap: Record<string, string> = {};
  for (const s of staff) nameMap[s.id] = s.full_name || s.email || "Staff";

  const board: BoardQuote[] = quotes.map((q) => ({
    id: q.id,
    name: q.name,
    phone: q.phone,
    service: q.service,
    city: q.city,
    address: q.address,
    status: q.status,
    assigned_to: q.assigned_to,
    quote_amount: q.quote_amount,
    view_count: q.view_count,
    quote_type: q.quote_type,
    created_at: q.created_at,
    scheduled_date: q.scheduled_date,
    visit_date: q.visit_date,
    visit_time: q.visit_time,
    confirmed_at: q.confirmed_at,
  }));

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="crm-muted">
            {board.length} {board.length === 1 ? "quote" : "quotes"}
            {isOwner ? "" : " assigned to you"} · drag a card or use Move to update it
          </p>
        </div>
      </div>

      <form className="crm-filters" method="get" action={`${base}/`}>
        <input className="crm-input" type="search" name="search" placeholder="Search name, phone, address…" defaultValue={sp.search ?? ""} />
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
        <button type="submit" className="crm-btn crm-btn-ghost">
          Search
        </button>
        {(sp.search || sp.assignedTo) && (
          <Link href={`${base}/`} className="crm-btn crm-btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {board.length === 0 ? (
        <div className="crm-empty">No quotes yet. New leads from the website will land in the New column.</div>
      ) : (
        <KanbanBoard
          base={base}
          role={isOwner ? "owner" : "contractor"}
          initialQuotes={board}
          contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
          nameMap={nameMap}
        />
      )}
    </main>
  );
}
