import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { LEAD_TIME_DAYS } from "@/lib/crm/constants";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { eventActor, eventText } from "@/lib/crm/events";
import { getQuote, listAgreementsForQuote, listContractors, listEvents, listStaff } from "@/lib/crm/queries";
import { AddAgreement } from "../../agreements/add-agreement";
import { AgreementList } from "../../agreements/agreement-list";
import { CopyField } from "../../copy-field";
import { PhotoGrid } from "../../photo-grid";
import { QuoteEditor } from "./quote-editor";
import { ScheduleCard } from "./schedule-card";
import { completeJob, markPaid, requestPayment, rotateTokens } from "./actions";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

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
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const t = dict(locale);
  const allStaff = await listStaff(session);
  const contractors = (isOwner ? allStaff : await listContractors(session)).filter((s) => s.role === "contractor");
  const nameMap = new Map(allStaff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
  const events = await listEvents(session, id);
  const agreements = await listAgreementsForQuote(session, id);
  const photoUrls = (quote.file_urls ?? []).map((p) => `${base}/api/file?p=${encodeURIComponent(p)}`);

  // Earliest day the crew can realistically start, matching what the customer
  // was shown when they picked their preferred days.
  const minJobDate = new Date(Date.now() + LEAD_TIME_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Scheduling only makes sense once the customer has actually said yes.
  const showSchedule = quote.customer_response === "accepted" && quote.status !== "lost";

  const customerLink = `${SITE_ORIGIN}/q/${quote.public_token}`;
  const jobLink = `${SITE_ORIGIN}/job/${quote.job_token}`;
  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  return (
    <main className="crm-page">
      <div className="crm-breadcrumb">
        <Link href={`${base}/`}>{t.job.backToAll}</Link>
      </div>

      <div className="crm-page-head">
        <h1>{quote.name}</h1>
        <span className={`crm-badge crm-badge-${quote.status}`}>{t.status[quote.status] ?? quote.status}</span>
      </div>

      <div className="crm-grid">
        <section className="crm-col">
          <div className="crm-card">
            <h2 className="crm-card-title">{t.job.customer}</h2>
            <dl className="crm-dl">
              <div>
                <dt>{t.job.phone}</dt>
                <dd>
                  <a href={`tel:${quote.phone.replace(/[^0-9+]/g, "")}`}>{quote.phone}</a>
                </dd>
              </div>
              {quote.email && (
                <div>
                  <dt>{t.job.email}</dt>
                  <dd>
                    <a href={`mailto:${quote.email}`}>{quote.email}</a>
                  </dd>
                </div>
              )}
              <div>
                <dt>{t.job.service}</dt>
                <dd>{quote.service || t.job.na}</dd>
              </div>
              <div>
                <dt>{t.job.type}</dt>
                <dd>{quote.quote_type === "online" ? t.job.typeOnline : quote.quote_type === "inperson" ? t.job.typeInPerson : t.job.na}</dd>
              </div>
              {quote.visit_date && (
                <div>
                  <dt>{t.job.requestedVisit}</dt>
                  <dd>
                    <strong className="crm-link-strong">{prettyDate(quote.visit_date)}</strong>
                    {quote.visit_time ? ` ${t.contractorJob.at} ${quote.visit_time}` : ""}
                  </dd>
                </div>
              )}
              {!quote.visit_date && quote.preferred_time && (
                <div>
                  <dt>{t.job.preferredTime}</dt>
                  <dd>{quote.preferred_time}</dd>
                </div>
              )}
              <div>
                <dt>{t.job.address}</dt>
                <dd>
                  {quote.address || t.job.na}
                  {mapsLink && (
                    <>
                      {" "}
                      <a href={mapsLink} target="_blank" rel="noreferrer" className="crm-link-strong">
                        {t.job.map}
                      </a>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t.job.received}</dt>
                <dd>{fmt(quote.created_at)}</dd>
              </div>
              <div>
                <dt>{t.job.customerViews}</dt>
                <dd>
                  {quote.view_count} {quote.viewed_at ? `· ${t.job.firstViewed} ${fmt(quote.viewed_at)}` : `· ${t.job.notOpened}`}
                </dd>
              </div>
              {quote.customer_response && (
                <div>
                  <dt>{t.job.customerResponse}</dt>
                  <dd>
                    {quote.customer_response === "accepted" ? (
                      <strong className="crm-link-strong">
                        {t.job.accepted}{quote.discount_accepted ? " ($150)" : ""}
                        {quote.scheduled_date ? ` · ${prettyDate(quote.scheduled_date)}` : ""}
                      </strong>
                    ) : (
                      t.job.declined
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {quote.details && (
              <div className="crm-details-block">
                <h3>{t.job.projectDetails}</h3>
                <p>{quote.details}</p>
              </div>
            )}
          </div>

          <div className="crm-card">
            <h2 className="crm-card-title">{t.job.photos} ({photoUrls.length})</h2>
            {photoUrls.length === 0 ? (
              <p className="crm-muted">
                {quote.quote_type === "online"
                  ? t.job.noFiles
                  : t.job.noFilesInPerson}
              </p>
            ) : (
              <PhotoGrid urls={photoUrls} />
            )}
          </div>

          <div className="crm-card">
            <h2 className="crm-card-title">Customer agreement ({agreements.length})</h2>
            <p className="crm-muted crm-sm">
              Send the agreement from DocuSeal, then track it here. {quote.email
                ? `DocuSeal will email ${quote.email}.`
                : "This customer has no email on file, so DocuSeal can't email them — share the signing link another way."}
            </p>
            <AgreementList agreements={agreements} isOwner={isOwner} />
            {isOwner && (
              <div className="ag-add">
                <AddAgreement kind="customer" targetId={quote.id} defaultTitle={`Customer agreement — ${quote.name}`} />
              </div>
            )}
          </div>

          {events.length > 0 && (
            <div className="crm-card">
              <h2 className="crm-card-title">{t.job.activity}</h2>
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

          {showSchedule && (
            <ScheduleCard
              id={quote.id}
              scheduledDate={quote.scheduled_date}
              preferredDates={quote.preferred_dates ?? []}
              minDate={minJobDate}
              locale={locale}
            />
          )}

          {quote.status === "scheduled" && (
            <div className="crm-card">
              <h2 className="crm-card-title">{t.finish.title}</h2>
              <p className="crm-muted crm-sm">
                {quote.confirmed_at ? t.finish.confirmed : t.finish.awaitingConfirm}{" "}
                {t.finish.hint}
              </p>
              <form action={completeJob}>
                <input type="hidden" name="id" value={quote.id} />
                <button type="submit" className="crm-btn crm-btn-primary">
                  {t.finish.markCompleted}
                </button>
              </form>
            </div>
          )}

          {quote.status === "completed" && (
            <div className="crm-card">
              <h2 className="crm-card-title">{t.finish.payTitle}</h2>
              <p className="crm-muted crm-sm">
                {quote.payment_requested_at
                  ? t.finish.paySent
                  : t.finish.payHint}
              </p>
              <div className="crm-editor-foot">
                <form action={requestPayment}>
                  <input type="hidden" name="id" value={quote.id} />
                  <button type="submit" className="crm-btn crm-btn-ghost">
                    {quote.payment_requested_at ? t.finish.resendPayment : t.finish.requestPayment}
                  </button>
                </form>
                <form action={markPaid}>
                  <input type="hidden" name="id" value={quote.id} />
                  <button type="submit" className="crm-btn crm-btn-primary">
                    {t.finish.markPaid}
                  </button>
                </form>
              </div>
            </div>
          )}

          {quote.status === "paid" && (
            <div className="crm-card">
              <h2 className="crm-card-title">{t.finish.paidTitle}</h2>
              <p className="crm-muted crm-sm">
                This job is paid and closed out{quote.paid_at ? ` (${fmt(quote.paid_at)})` : ""}. Nothing else to do.
              </p>
            </div>
          )}

          <div className="crm-card">
            <h2 className="crm-card-title">{t.links.title}</h2>
            <p className="crm-muted crm-sm">
              {t.links.hint}
            </p>
            <CopyField label={t.links.customerLink} value={customerLink} />
            <CopyField label={t.links.jobLink} value={jobLink} />
            <div className="crm-editor-foot">
              <form action={rotateTokens}>
                <input type="hidden" name="id" value={quote.id} />
                <button type="submit" className="crm-btn crm-btn-ghost">
                  {t.links.regenerate}
                </button>
              </form>
              <span className="crm-muted crm-sm">{t.links.regenerateHint}</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
