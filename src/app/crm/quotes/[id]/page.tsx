import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { STATUS_LABELS } from "@/lib/crm/constants";
import { crmBase } from "@/lib/crm/nav";
import { getQuote, listContractors, listEvents } from "@/lib/crm/queries";
import { CopyField } from "../../copy-field";
import { PhotoGrid } from "../../photo-grid";
import { QuoteEditor } from "./quote-editor";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const EVENT_LABELS: Record<string, string> = {
  status_changed: "Status changed",
  assigned: "Assigned",
  quote_sent: "Quote sent to customer",
  customer_viewed: "Customer viewed their quote",
  customer_accepted: "Customer ACCEPTED their quote",
  customer_declined: "Customer declined their quote",
  updated: "Updated",
};

function prettyDate(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const base = await crmBase();
  const { id } = await params;

  const quote = await getQuote(session, id);
  if (!quote) notFound();

  const isOwner = session.staff.role === "owner";
  const contractors = isOwner ? await listContractors(session) : [];
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
              {quote.preferred_time && (
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
                      <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
                      <div className="crm-muted crm-sm">{fmt(e.created_at)}</div>
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
