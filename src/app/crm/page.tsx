import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { listCrewViews } from "@/lib/crm/crew-views";
import { listQuotes, listStaff } from "@/lib/crm/queries";
import { KanbanBoard, type BoardQuote } from "./kanban-board";
import { NewQuoteForm } from "./new-quote-form";

export const dynamic = "force-dynamic";

type SP = { search?: string; assignedTo?: string };

export default async function CrmDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const isOwner = session.staff.role === "owner";
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const t = dict(locale);

  const [quotes, staff, crewViews] = await Promise.all([
    listQuotes(session, { search: sp.search, assignedTo: sp.assignedTo }),
    listStaff(session),
    // Owner only; empty for anyone else.
    listCrewViews(session),
  ]);
  // Opens by the CURRENT contractor, for the owner's card pill.
  const crewViewsOf = new Map(crewViews.map((v) => [`${v.quote_id}:${v.staff_id}`, v]));
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
    crew_views: q.assigned_to ? (crewViewsOf.get(`${q.id}:${q.assigned_to}`)?.view_count ?? 0) : 0,
    crew_closed_views: q.assigned_to ? (crewViewsOf.get(`${q.id}:${q.assigned_to}`)?.closed_view_count ?? 0) : 0,
    quote_type: q.quote_type,
    created_at: q.created_at,
    scheduled_date: q.scheduled_date,
    scheduled_time: q.scheduled_time,
    visit_date: q.visit_date,
    visit_time: q.visit_time,
    job_token: q.job_token,
    is_test: q.is_test === true,
  }));

  return (
    <main className="crm-page crm-page-wide">
      <div className="crm-page-head">
        <div>
          <h1>{t.pipeline.title}</h1>
          <p className="crm-muted">
            {board.length} {board.length === 1 ? t.pipeline.quote : t.pipeline.quotes}
            {isOwner ? "" : ` ${t.pipeline.assignedToYou}`}{" · "}
            {/* No drag on a phone, which shows one stage at a time. */}
            <span className="kb-wide-only">{t.pipeline.dragHint}</span>
            <span className="kb-narrow-only">{t.pipeline.tapHint}</span>
          </p>
        </div>
        {isOwner && (
          <NewQuoteForm
            contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
          />
        )}
      </div>

      <form className="crm-filters" method="get" action={`${base}/`}>
        <input className="crm-input" type="search" name="search" placeholder={t.pipeline.search} defaultValue={sp.search ?? ""} />
        {isOwner && (
          <select className="crm-input" name="assignedTo" defaultValue={sp.assignedTo ?? ""}>
            <option value="">{t.pipeline.anyAssignee}</option>
            <option value="unassigned">{t.pipeline.unassigned}</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name || c.email}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="crm-btn crm-btn-ghost">
          {t.pipeline.filter}
        </button>
        {(sp.search || sp.assignedTo) && (
          <Link href={`${base}/`} className="crm-btn crm-btn-ghost">
            {t.pipeline.clear}
          </Link>
        )}
      </form>

      {board.length === 0 ? (
        <div className="crm-empty">{t.pipeline.empty}</div>
      ) : (
        <KanbanBoard
          base={base}
          role={isOwner ? "owner" : "contractor"}
          initialQuotes={board}
          contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
          nameMap={nameMap}
          locale={locale}
        />
      )}
    </main>
  );
}
