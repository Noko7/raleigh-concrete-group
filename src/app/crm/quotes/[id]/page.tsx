import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { STATUS_LABELS } from "@/lib/crm/constants";
import { crmBase } from "@/lib/crm/nav";
import type { QuoteEvent } from "@/lib/crm/types";
import { getQuote, listContractors, listEvents, listStaff } from "@/lib/crm/queries";
import { CopyField } from "../../copy-field";
import { PhotoGrid } from "../../photo-grid";
import { QuoteEditor } from "./quote-editor";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function prettyDate(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

const statusLabel = (v: unknown) => STATUS_LABELS[String(v) as keyof typeof STATUS_LABELS] ?? String(v ?? "—");

// Who triggered the event: a named teammate, the customer, or an automatic change.
function eventActor(e: QuoteEvent, names: Map<string, string>): string {
  if (e.actor) return names.get(e.actor) ?? "A teammate";
  if (e.type.startsWith("customer_")) return "Customer";
  return "Automatic";
}

// Plain-English, audit-friendly description of what happened.
function eventText(e: QuoteEvent, names: Map<string, string>): string {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case "status_changed":
      return `Status: ${statusLabel(m.from)} → ${statusLabel(m.to)}`;
    case "assigned":
      return m.to ? `Assigned to ${names.get(String(m.to)) ?? "a contractor"}` : "Unassigned";
    case "amount_changed":
      return `Price set to ${m.to != null ? `$${Number(m.to).toLocaleString("en-US")}` : "(cleared)"}`;
    case "summary_changed":
      return "Customer description updated";
    case "notes_changed":
      return "Internal notes updated";
    case "quote_sent":
      return "Quote sent to the customer";
    case "customer_viewed":
      return "Customer opened their quote";
    case "customer_accepted":
      return `Customer accepted${m.scheduled_date ? ` — booked ${String(m.scheduled_date)}` : ""}${m.discount ? " (10% off)" : ""}`;
    case "customer_declined":
      return "Customer declined the quote";
    default:
      return e.type.replace(/_/g, " ");
  }
}

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const base = await crmBase();
  const { id } = await params;

  const quote = await getQuote(session, id);
  if (!quote) notFound();

  const isOwner = session.staff.role === "owner";
  const allStaff = await listStaff(session);
  const contractors = (isOwner ? allStaff : await listContractors(session)).filter((s) => s.role === "contractor");
  const nameMap = new Map(allStaff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
  const events = await listEvents(session, id);
  const photoUrls = (quote.file_urls ?? []).map((p) => `${base}/api/file?p=${encodeURIComponent(p)}`);

  const customerLink = `${SITE_ORIGIN}/q/${quote.public_token}`;
  const jobLink = `${SITE_ORIGIN}/job/${quote.job_token}`;
  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  return (
    <main className="crm-page">
      <div className="crm-breadcrumb">
        <Link href={`${base}/`}>← All quotes</Link>
      </div>

      <div className="crm-page-head">
        <h1>{quote.name}</h1>
        <span className={`crm-badge crm-badge-${quote.status}`}>{STATUS_LABELS[quote.status] ?? quote.status}</span>
      </div>

      <div className="crm-grid">
        <section className="crm-col">
          <div className="crm-card">
            <h2 className="crm-card-title">Customer</h2>
            <dl className="crm-dl">
              <div>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${quote.phone.replace(/[^0-9+]/g, "")}`}>{quote.phone}</a>
                </dd>
              </div>
              {quote.email && (
                <div>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${quote.email}`}>{quote.email}</a>
                  </dd>
                </div>
              )}
              <div>
                <dt>Service</dt>
                <dd>{quote.service || "—"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{quote.quote_type === "online" ? "Online (photos)" : quote.quote_type === "inperson" ? "In-person" : "—"}</dd>
              </div>
              {quote.visit_date && (
                <div>
                  <dt>Requested visit</dt>
                  <dd>
                    <strong className="crm-link-strong">{prettyDate(quote.visit_date)}</strong>
                    {quote.visit_time ? ` at ${quote.visit_time}` : ""}
                  </dd>
                </div>
              )}
              {!quote.visit_date && quote.preferred_time && (
                <div>
                  <dt>Preferred time</dt>
                  <dd>{quote.preferred_time}</dd>
                </div>
              )}
              <div>
                <dt>Address</dt>
                <dd>
                  {quote.address || "—"}
                  {mapsLink && (
                    <>
                      {" "}
                      <a href={mapsLink} target="_blank" rel="noreferrer" className="crm-link-strong">
                        Map
                      </a>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Received</dt>
                <dd>{fmt(quote.created_at)}</dd>
              </div>
              <div>
                <dt>Customer views</dt>
                <dd>
                  {quote.view_count} {quote.viewed_at ? `· first ${fmt(quote.viewed_at)}` : "· not opened yet"}
                </dd>
              </div>
              {quote.customer_response && (
                <div>
                  <dt>Customer response</dt>
                  <dd>
                    {quote.customer_response === "accepted" ? (
                      <strong className="crm-link-strong">
                        Accepted{quote.discount_accepted ? " (10% off)" : ""}
                        {quote.scheduled_date ? ` · ${prettyDate(quote.scheduled_date)}` : ""}
                      </strong>
                    ) : (
                      "Declined"
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {quote.details && (
              <div className="crm-details-block">
                <h3>Project details</h3>
                <p>{quote.details}</p>
              </div>
            )}
          </div>

          <div className="crm-card">
            <h2 className="crm-card-title">Photos &amp; video ({photoUrls.length})</h2>
            {photoUrls.length === 0 ? (
              <p className="crm-muted">
                {quote.quote_type === "online"
                  ? "No files were uploaded with this request."
                  : "This was an in-person request, so no photos were uploaded."}
              </p>
            ) : (
              <PhotoGrid urls={photoUrls} />
            )}
          </div>

          {events.length > 0 && (
            <div className="crm-card">
              <h2 className="crm-card-title">Activity</h2>
              <ul className="crm-timeline">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="crm-timeline-dot" />
                    <div>
                      <strong>{eventText(e, nameMap)}</strong>
                      <div className="crm-muted crm-sm">
                        {eventActor(e, nameMap)} · {fmt(e.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="crm-col">
          <QuoteEditor
            id={quote.id}
            isOwner={isOwner}
            customerName={quote.name}
            contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
            initial={{
              status: quote.status,
              assigned_to: quote.assigned_to,
              quote_amount: quote.quote_amount,
              quote_summary: quote.quote_summary,
              internal_notes: quote.internal_notes,
            }}
          />

          <div className="crm-card">
            <h2 className="crm-card-title">Shareable links</h2>
            <p className="crm-muted crm-sm">
              Text the customer link after you set an amount and summary. The job link shows photos and address to a
              contractor without a login.
            </p>
            <CopyField label="Customer quote (branded, tracked)" value={customerLink} />
            <CopyField label="Contractor job link (photos + address)" value={jobLink} />
          </div>
        </section>
      </div>
    </main>
  );
}
