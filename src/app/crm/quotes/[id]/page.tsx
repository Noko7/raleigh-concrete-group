import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { requestedVisitOf, visitDateOf } from "@/lib/crm/constants";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { eventActor, eventText } from "@/lib/crm/events";
import {
  getQuote,
  listAgreementsForQuote,
  listContractors,
  listEvents,
  listMessages,
  listStaff,
} from "@/lib/crm/queries";
import { AddAgreement } from "../../agreements/add-agreement";
import { AgreementList } from "../../agreements/agreement-list";
import { CopyField } from "../../copy-field";
import { PhotoGrid } from "../../photo-grid";
import { PhotoUpload } from "../../photo-upload";
import { CompleteCard } from "./complete-card";
import { MessageLog } from "./message-log";
import { QuoteEditor } from "./quote-editor";
import { ScheduleCard } from "./schedule-card";
import { markPaid, requestPayment, rotateTokens } from "./actions";

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
  // The crew has one job page, not two. Everything a contractor can do lives on
  // /job/<token> - the URL that's already in every text we send them - so this
  // page is the owner's view and anyone else gets sent to theirs. Without this
  // the same job has two different-looking screens depending on how you got to
  // it, which is exactly the confusion this removes.
  if (!isOwner && quote.job_token) redirect(`/job/${quote.job_token}`);
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const t = dict(locale);
  const allStaff = await listStaff(session);
  const contractors = (isOwner ? allStaff : await listContractors(session)).filter((s) => s.role === "contractor");
  const nameMap = new Map(allStaff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
  const events = await listEvents(session, id);
  const messages = await listMessages(session, id);
  const agreements = await listAgreementsForQuote(session, id);
  // Every photo on this page is served through the same authenticated proxy,
  // so a signed URL never leaves the CRM.
  const viaProxy = (paths: string[] | null) =>
    (paths ?? []).map((p) => `${base}/api/file?p=${encodeURIComponent(p)}`);
  const photoUrls = viaProxy(quote.file_urls);
  const internalUrls = viaProxy(quote.internal_urls);
  const beforeUrls = viaProxy(quote.before_urls);
  const afterUrls = viaProxy(quote.after_urls);
  // The same column, read two ways: a booked visit on an in-person request, or
  // the slot an online customer offered in case photos aren't enough. Only one
  // of these is ever set, and they are never labelled the same.
  const visitDate = visitDateOf(quote);
  const offeredVisit = requestedVisitOf(quote);

  // The lead time governs what a CUSTOMER may request, not what the business
  // may agree to. You can book any day from today, including a rush job someone
  // arranged over the phone.
  const minJobDate = new Date().toISOString().slice(0, 10);
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
                <dd>
                  {quote.quote_type === "online"
                    ? t.job.typeOnline
                    : quote.quote_type === "plans"
                      ? t.job.typePlans
                      : quote.quote_type === "inperson"
                        ? t.job.typeInPerson
                        : t.job.na}
                </dd>
              </div>
              {visitDate && (
                <div>
                  <dt>{t.job.requestedVisit}</dt>
                  <dd>
                    <strong className="crm-link-strong">{prettyDate(visitDate)}</strong>
                    {quote.visit_time ? ` ${t.contractorJob.at} ${quote.visit_time}` : ""}
                  </dd>
                </div>
              )}
              {offeredVisit && (
                <div>
                  <dt>{t.job.offeredVisit}</dt>
                  <dd>
                    {prettyDate(offeredVisit)}
                    {quote.visit_time ? ` ${t.contractorJob.at} ${quote.visit_time}` : ""}
                    <span className="crm-muted crm-sm"> — {t.job.offeredVisitHint}</span>
                  </dd>
                </div>
              )}
              {!visitDate && !offeredVisit && quote.preferred_time && (
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
                        {quote.scheduled_date
                          ? ` · ${prettyDate(quote.scheduled_date)}${quote.scheduled_time ? ` ${t.contractorJob.at} ${quote.scheduled_time}` : ""}`
                          : ""}
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

          {/* Ours, kept apart from the customer's own uploads above. Which
              set a photo belongs to is the point: the before/after pair is
              the record of the work, and a picture the customer sent in
              before we started is not that. */}
          <div className="crm-card">
            <h2 className="crm-card-title">Our photos</h2>
            <p className="crm-muted crm-sm">Only staff see these. The customer&apos;s quote page never shows photos.</p>

            <h3 className="crm-photo-head">Site notes ({internalUrls.length})</h3>
            {internalUrls.length > 0 && <PhotoGrid urls={internalUrls} />}
            <PhotoUpload quoteId={quote.id} kind="internal" label="Add site photos" />

            <h3 className="crm-photo-head">Before ({beforeUrls.length})</h3>
            {beforeUrls.length > 0 && <PhotoGrid urls={beforeUrls} />}
            <PhotoUpload quoteId={quote.id} kind="before" label="Add before photos" />

            <h3 className="crm-photo-head">After ({afterUrls.length})</h3>
            {afterUrls.length > 0 && <PhotoGrid urls={afterUrls} />}
            <PhotoUpload quoteId={quote.id} kind="after" label="Add after photos" />
          </div>

          <div className="crm-card">
            <h2 className="crm-card-title">Customer agreement ({agreements.length})</h2>
            <p className="crm-muted crm-sm">
              Send the agreement from DocuSeal, then track it here. {quote.email
                ? `DocuSeal will email ${quote.email}.`
                : "This customer has no email on file, so DocuSeal can't email them — share the signing link another way."}
            </p>
            <AgreementList agreements={agreements} isOwner={isOwner} locale={locale} />
            {isOwner && (
              <div className="ag-add">
                <AddAgreement kind="customer" targetId={quote.id} defaultTitle={`Customer agreement — ${quote.name}`} />
              </div>
            )}
          </div>

          {/* Above the activity log on purpose: the activity log says what
              happened, this says whether anyone was told. */}
          <MessageLog messages={messages} />

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
            awaitingReply={Boolean(quote.quote_sent_at) && !quote.customer_response}
            contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
            initial={{
              status: quote.status,
              name: quote.name,
              assigned_to: quote.assigned_to,
              quote_amount: quote.quote_amount,
              quote_summary: quote.quote_summary,
              internal_notes: quote.internal_notes,
              quote_scope: quote.quote_scope,
              quote_permits: quote.quote_permits,
              quote_prep: quote.quote_prep,
              quote_pour: quote.quote_pour,
              quote_cleanup: quote.quote_cleanup,
            }}
          />

          {showSchedule && (
            <ScheduleCard
              id={quote.id}
              scheduledDate={quote.scheduled_date}
              scheduledTime={quote.scheduled_time}
              preferredDates={quote.preferred_dates ?? []}
              minDate={minJobDate}
              locale={locale}
            />
          )}

          {quote.status === "scheduled" && (
            <CompleteCard
              id={quote.id}
              title={t.finish.title}
              hint={t.finish.hint}
              statusNote={quote.confirmed_at ? t.finish.confirmed : t.finish.awaitingConfirm}
              statusIsWarning={!quote.confirmed_at}
              buttonLabel={t.finish.markCompleted}
              beforeCount={quote.before_urls?.length ?? 0}
              afterCount={quote.after_urls?.length ?? 0}
            />
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
