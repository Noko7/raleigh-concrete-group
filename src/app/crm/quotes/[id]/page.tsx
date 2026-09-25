import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { requestedVisitOf, visitDateOf } from "@/lib/crm/constants";
import { BUSINESS_TZ, todayYmd } from "@/lib/crm/clock";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { eventActor, eventText, quoteSends } from "@/lib/crm/events";
import { signMediaPath } from "@/lib/crm/media-token";
import { jobLedger, payeeState } from "@/lib/crm/payments";
import { usd } from "@/lib/crm/fees";
import {
  getQuote,
  listAgreementsForQuote,
  listContractors,
  listEvents,
  listMessages,
  listQuoteOptions,
  listQuotePackages,
  listStaff,
} from "@/lib/crm/queries";
import { AddAgreement } from "../../agreements/add-agreement";
import { AgreementList } from "../../agreements/agreement-list";
import { CopyField } from "../../copy-field";
import { PhotoGrid } from "../../photo-grid";
import { PhotoUpload } from "../../photo-upload";
import { AcceptOffline } from "./accept-offline";
import { CompleteCard } from "./complete-card";
import { MessageLog } from "./message-log";
import { JobSettings } from "./job-settings";
import { QuoteEditor } from "./quote-editor";
import { QuoteSends } from "./quote-sends";
import { CancelAppointment } from "./cancel-appointment";
import { QuotePayments } from "./quote-payments";
import { ScheduleCard } from "./schedule-card";
import { preferredSlots } from "./types";
import { rotateTokens, setTestFlag } from "./actions";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
}

// The six places a job can be, left to right. "Lost" is not one of them: it is
// a way out of the line, shown instead of it.
const STAGES = [
  { key: "new", label: "Lead" },
  { key: "quoted", label: "Quoted" },
  { key: "approved", label: "Approved" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Done" },
  { key: "paid", label: "Paid" },
] as const;

function shortDay(s: string) {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
  // Four independent queries that used to run one after another, so opening a
  // job cost four sequential round-trips to Supabase before anything rendered.
  // None of them depends on another's result.
  const [allStaff, events, messages, agreements, options, packages] = await Promise.all([
    listStaff(session),
    listEvents(session, id),
    listMessages(session, id),
    listAgreementsForQuote(session, id),
    listQuoteOptions(session, id),
    listQuotePackages(session, id),
  ]);
  // Only reachable by a contractor on a job with no crew link (the redirect
  // above catches every other case), so it stays out of the batch.
  const contractors = (isOwner ? allStaff : await listContractors(session)).filter((s) => s.role === "contractor");
  const nameMap = new Map(allStaff.map((s) => [s.id, s.full_name || s.email || "Staff"]));
  // Every photo on this page is served through the same authenticated proxy,
  // so a signed URL never leaves the CRM.
  //
  // Signed against whoever is looking. This page has already decided they may
  // see this job - getQuote ran as them, through RLS - and the signature is
  // that decision travelling with the URL, so the proxy can honour it without
  // asking the database again per thumbnail.
  // Another option can go out while the quote is live and unanswered. Approved,
  // declined or closed out are all different conversations, and each one has
  // its own door elsewhere on this page.
  const canAddOption =
    Boolean(quote.quote_sent_at) &&
    !quote.customer_response &&
    quote.status !== "lost" &&
    quote.status !== "completed" &&
    quote.status !== "paid";

  const viaProxy = (paths: string[] | null) =>
    (paths ?? []).map((p) => `${base}/api/file?${signMediaPath(p, session.staff.id)}`);
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
  const minJobDate = todayYmd();
  // Scheduling only makes sense once the customer has actually said yes.
  const showSchedule = quote.customer_response === "accepted" && quote.status !== "lost";
  // ...and until they have, the office needs the other way of saying yes: the
  // customer who agreed on the phone and never touched their link. Offered only
  // on a quote that has actually gone out and carries a price, so what is being
  // approved is something the customer has in front of them.
  const showOfflineAccept =
    !quote.customer_response &&
    quote.status !== "lost" &&
    quote.status !== "completed" &&
    quote.status !== "paid" &&
    Boolean(quote.quote_sent_at) &&
    quote.quote_amount != null;

  // Same gate for the money: there is nothing to collect against a price the
  // customer hasn't agreed to.
  // One wave, not two: neither of these needs the other's answer, and on a
  // page that already waits on a batch of five they were two more round-trips
  // stacked end to end before anything could render.
  const [money, payee] = await Promise.all([
    showSchedule ? jobLedger(quote) : Promise.resolve(null),
    showSchedule ? payeeState(quote) : Promise.resolve(null),
  ]);
  const cardReady = money ? (payee?.ok ?? false) : false;

  const customerLink = `${SITE_ORIGIN}/q/${quote.public_token}`;
  const jobLink = `${SITE_ORIGIN}/job/${quote.job_token}`;
  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  // ── What to do next ──
  // One card, one sentence, one button, worked out from where the job is. The
  // page has fifteen things on it; this is the one that moves the job along.
  const firstName = quote.name.split(" ")[0];
  const stageIndex = Math.max(0, STAGES.findIndex((st) => st.key === quote.status));
  const dueCents = money?.ledger.dueCents ?? 0;
  const next: { tone: "go" | "wait" | "done" | "lost"; title: string; body: string; href?: string; cta?: string } =
    quote.status === "lost"
      ? { tone: "lost", title: "Marked lost", body: "Change the status under Job if it comes back." }
      : quote.status === "paid"
        ? { tone: "done", title: "All done", body: "The work is finished and the job is paid in full." }
        : quote.status === "completed"
          ? dueCents > 0
            ? { tone: "go", title: `Collect ${usd(dueCents)}`, body: "The work is done. Take the balance or record a payment.", href: "#payments", cta: "Take payment" }
            : { tone: "done", title: "Done and paid up", body: "Nothing is owed on this job." }
          : quote.status === "scheduled"
            ? {
                tone: "go",
                title: "Mark it done after the work",
                body: quote.scheduled_date
                  ? `Booked for ${prettyDate(quote.scheduled_date)}${quote.scheduled_time ? ` at ${quote.scheduled_time}` : ""}.`
                  : "It's on the calendar.",
                href: "#finish",
                cta: "Mark done",
              }
            : quote.customer_response === "accepted"
              ? {
                  tone: "go",
                  title: "Pick the work day",
                  body:
                    (quote.preferred_dates ?? []).filter(Boolean).length > 0
                      ? `${firstName} approved and suggested ${(quote.preferred_dates ?? []).filter(Boolean).map(shortDay).join(", ")}.`
                      : `${firstName} approved the quote.`,
                  href: "#schedule",
                  cta: "Schedule it",
                }
              : quote.customer_response === "declined"
                ? {
                    tone: "wait",
                    title: `${firstName} declined, now reopened`,
                    body: "Their link shows the quote again. Change the price or split it into a pick-one choice, then send it.",
                    href: "#quote",
                    cta: "Edit and send",
                  }
                : quote.quote_sent_at
                  ? {
                      tone: "wait",
                      title: `Waiting on ${firstName}`,
                      body: `Sent ${fmt(quote.quote_sent_at)}. ${
                        quote.view_count > 0 ? `Opened ${quote.view_count} time${quote.view_count === 1 ? "" : "s"}.` : "Not opened yet."
                      }`,
                      href: showOfflineAccept ? "#accept" : undefined,
                      cta: showOfflineAccept ? "They said yes by phone" : undefined,
                    }
                  : {
                      tone: "go",
                      title: "Send the quote",
                      body: visitDate
                        ? `Visit ${prettyDate(visitDate)}${quote.visit_time ? ` at ${quote.visit_time}` : ""}. Price it after.`
                        : photoUrls.length
                          ? `${firstName} sent ${photoUrls.length} photo${photoUrls.length === 1 ? "" : "s"}. Price it from those.`
                          : `No photos yet. Call ${firstName} or book a visit.`,
                      href: "#quote",
                      cta: "Write the quote",
                    };

  const phoneDigits = quote.phone.replace(/[^0-9+]/g, "");
  const photoCount = internalUrls.length + beforeUrls.length + afterUrls.length;

  return (
    <main className="crm-page jb">
      <div className="crm-breadcrumb">
        <Link href={`${base}/`}>{t.job.backToAll}</Link>
      </div>

      {/* ── Who, and the three ways to reach them ── */}
      <header className="jb-head">
        <div className="jb-id">
          <div className="jb-name">
            <h1>{quote.name}</h1>
            <span className={`crm-badge crm-badge-${quote.status}`}>{t.status[quote.status] ?? quote.status}</span>
            {quote.is_test && <span className="test-pill">Practice</span>}
          </div>
          <p className="jb-what">
            {[quote.service, quote.address].filter(Boolean).join(" · ") || t.job.na}
          </p>
        </div>
        <nav className="jb-actions" aria-label="Contact">
          <a href={`tel:${phoneDigits}`} className="crm-btn crm-btn-primary">Call</a>
          <a href={`sms:${phoneDigits}`} className="crm-btn crm-btn-ghost">Text</a>
          {mapsLink && (
            <a href={mapsLink} target="_blank" rel="noreferrer" className="crm-btn crm-btn-ghost">Map</a>
          )}
          <a href={customerLink} target="_blank" rel="noreferrer" className="crm-btn crm-btn-ghost">Their quote page</a>
        </nav>
      </header>

      {/* ── Where it is ── */}
      {quote.status === "lost" ? null : (
        <ol className="jb-stages" aria-label="Job stage">
          {STAGES.map((st, i) => (
            <li
              key={st.key}
              className={i < stageIndex ? "jb-stage jb-stage-past" : i === stageIndex ? "jb-stage jb-stage-now" : "jb-stage"}
              aria-current={i === stageIndex ? "step" : undefined}
            >
              {st.label}
            </li>
          ))}
        </ol>
      )}

      {/* ── What to do about it ── */}
      <section className={`jb-next jb-next-${next.tone}`} aria-label="Next up">
        <div>
          <p className="jb-next-title">{next.title}</p>
          <p className="jb-next-body">{next.body}</p>
        </div>
        {next.href && next.cta && (
          <a href={next.href} className="crm-btn crm-btn-primary jb-next-btn">
            {next.cta}
          </a>
        )}
      </section>

      <div className="jb-grid">
        {/* ── The work: whichever step is live, then the quote ── */}
        <div className="jb-main">
          {showOfflineAccept && (
            <div className="jb-o-step" id="accept">
              <AcceptOffline
                id={quote.id}
                customerName={quote.name}
                amount={quote.quote_amount}
                options={options.map((o) => ({
                  id: o.id,
                  title: o.title,
                  description: o.description,
                  amount: Number(o.amount),
                  required: o.required,
                }))}
                packages={packages.map((p) => ({
                  id: p.id,
                  title: p.title,
                  amount: Number(p.amount),
                  recommended: p.recommended,
                }))}
                minDate={minJobDate}
                locale={locale}
              />
            </div>
          )}

          {showSchedule && (
            <div className="jb-o-step" id="schedule">
              <ScheduleCard
                id={quote.id}
                scheduledDate={quote.scheduled_date}
                scheduledTime={quote.scheduled_time}
                preferred={preferredSlots(quote.preferred_dates, quote.preferred_times)}
                minDate={minJobDate}
                locale={locale}
              />
            </div>
          )}

          {quote.status === "scheduled" && (
            <div className="jb-o-step" id="finish">
              <CompleteCard
                id={quote.id}
                title={t.finish.title}
                hint={t.finish.hint}
                // Not a warning. The reminder two days out is a courtesy
                // check-in, and a job that hasn't had one yet is not a job in
                // trouble.
                statusNote={quote.confirmed_at ? t.finish.confirmed : t.finish.scheduledNote}
                statusIsWarning={false}
                buttonLabel={t.finish.markCompleted}
                beforeCount={quote.before_urls?.length ?? 0}
                afterCount={quote.after_urls?.length ?? 0}
              />
            </div>
          )}

          {/* The money on this job, from the moment they approve: a deposit is
              collected long before the work is finished. */}
          {money && (
            <div className="jb-o-step" id="payments">
              <QuotePayments
                id={quote.id}
                locale={locale}
                isOwner={isOwner}
                cardReady={cardReady}
                totalCents={money.ledger.totalCents}
                paidCents={money.ledger.paidCents}
                dueCents={money.ledger.dueCents}
                feeTotalCents={money.ledger.feeTotalCents}
                feeCollectedCents={money.ledger.feeCollectedCents}
                feeDueCents={money.ledger.feeDueNowCents}
                rows={money.rows.map((r) => ({
                  id: r.id,
                  method: r.method,
                  amount_cents: r.amount_cents,
                  refunded_cents: r.refunded_cents,
                  status: r.status,
                  paid_at: r.paid_at,
                  created_at: r.created_at,
                  // Only a settled card payment has anything on Stripe's side
                  // to reverse.
                  refundable:
                    r.method === "card" && r.status !== "pending" && Boolean(r.payment_intent_id && r.stripe_account_id),
                }))}
              />
            </div>
          )}

          <QuoteEditor
            id={quote.id}
            options={options.map((o) => ({
              id: o.id,
              title: o.title,
              description: o.description,
              // numeric(10,2) arrives as a string from PostgREST.
              amount: Number(o.amount),
              required: o.required,
              customer_response: o.customer_response,
            }))}
            packages={packages.map((p) => ({
              id: p.id,
              title: p.title,
              description: p.description,
              amount: Number(p.amount),
              recommended: p.recommended,
              customer_response: p.customer_response,
            }))}
            customerName={quote.name}
            awaitingReply={Boolean(quote.quote_sent_at) && !quote.customer_response}
            initial={{
              quote_amount: quote.quote_amount,
              quote_summary: quote.quote_summary,
              customer_response: quote.customer_response,
              status: quote.status,
              quote_scope: quote.quote_scope,
              quote_permits: quote.quote_permits,
              quote_prep: quote.quote_prep,
              quote_pour: quote.quote_pour,
              quote_cleanup: quote.quote_cleanup,
            }}
          />

          {/* Every price this customer has been given, under the quote it is
              the history of. Where a sent quote is taken back or another
              option goes out. */}
          <QuoteSends
              quoteId={quote.id}
              customerName={quote.name}
              sends={quoteSends(events, quote.quote_amount)}
              canRetract={isOwner}
              canAddOption={canAddOption}
              currentAmount={quote.quote_amount}
              service={quote.service}
              options={packages.map((p) => ({ id: p.id, title: p.title, amount: Number(p.amount), recommended: p.recommended }))}
              locale={locale}
            />
        </div>

        {/* ── The facts: who, what they asked for, the job's settings ── */}
        <aside className="jb-side">
          <div className="crm-card jb-o-customer">
            <h2 className="crm-card-title">{t.job.customer}</h2>
            <dl className="crm-dl jb-dl">
              <div>
                <dt>{t.job.phone}</dt>
                <dd>
                  <a href={`tel:${phoneDigits}`}>{quote.phone}</a>
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
                    <span className="crm-muted crm-sm"> ({t.job.offeredVisitHint})</span>
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
                <dt>{t.job.received}</dt>
                <dd>{fmt(quote.created_at)}</dd>
              </div>
              <div>
                <dt>{t.job.customerViews}</dt>
                <dd>
                  {quote.view_count} {quote.viewed_at ? `· ${t.job.firstViewed} ${fmt(quote.viewed_at)}` : `· ${t.job.notOpened}`}
                </dd>
              </div>
            </dl>
            {quote.details && (
              <div className="crm-details-block">
                <h3>{t.job.projectDetails}</h3>
                <p>{quote.details}</p>
              </div>
            )}
          </div>

          <JobSettings
            id={quote.id}
            contractors={contractors.map((c) => ({ id: c.id, label: c.full_name || c.email || "Contractor" }))}
            initial={{
              name: quote.name,
              status: quote.status,
              assigned_to: quote.assigned_to,
              internal_notes: quote.internal_notes,
            }}
          />

          <div className="crm-card jb-o-photos">
            <h2 className="crm-card-title">
              {t.job.photos} ({photoUrls.length})
            </h2>
            {photoUrls.length === 0 ? (
              <p className="crm-muted">{quote.quote_type === "online" ? t.job.noFiles : t.job.noFilesInPerson}</p>
            ) : (
              <PhotoGrid urls={photoUrls} />
            )}
          </div>

          {/* Everything that is looked at now and then rather than every
              visit. Closed by default so the page stays about the next step;
              the count on each says whether there is anything inside. */}
          <div className="jb-more">
            {/* Ours, kept apart from the customer's uploads above: the
                before/after pair is the record of the work. */}
            <details className="jb-fold">
              <summary>
                Our photos <span className="jb-count">{photoCount}</span>
              </summary>
              <div className="jb-fold-body">
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
            </details>

            {/* Whether anyone was actually told, then everything that ever
                happened to the job. */}
            <details className="jb-fold">
              <summary>
                Texts sent <span className="jb-count">{messages.length}</span>
              </summary>
              <div className="jb-fold-body jb-fold-flat">
                <MessageLog messages={messages} isOwner={isOwner} />
              </div>
            </details>

            <details className="jb-fold">
              <summary>
                {t.job.activity} <span className="jb-count">{events.length}</span>
              </summary>
              <div className="jb-fold-body">
                {events.length === 0 ? (
                  <p className="crm-muted crm-sm">Nothing yet.</p>
                ) : (
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
                )}
              </div>
            </details>

            <details className="jb-fold">
              <summary>
                Customer agreement <span className="jb-count">{agreements.length}</span>
              </summary>
              <div className="jb-fold-body">
                <p className="crm-muted crm-sm">
                  Send the agreement from DocuSeal, then track it here.{" "}
                  {quote.email
                    ? `DocuSeal will email ${quote.email}.`
                    : "This customer has no email on file, so DocuSeal can't email them. Share the signing link another way."}
                </p>
                <AgreementList agreements={agreements} isOwner={isOwner} locale={locale} />
                {isOwner && (
                  <div className="ag-add">
                    <AddAgreement kind="customer" targetId={quote.id} defaultTitle={`Customer agreement for ${quote.name}`} />
                  </div>
                )}
              </div>
            </details>

            {(quote.scheduled_date || visitDate) && quote.status !== "completed" && quote.status !== "paid" && (
              <details className="jb-fold">
                <summary>{t.calendar.cancelAppt}</summary>
                {/* One control per appointment the job has: a booked work day
                    and a quote visit are different days and different texts. */}
                <div className="jb-fold-body">
                  {quote.scheduled_date && (
                    <CancelAppointment id={quote.id} kind="job" customerName={quote.name} locale={locale} />
                  )}
                  {visitDate && <CancelAppointment id={quote.id} kind="visit" customerName={quote.name} locale={locale} />}
                </div>
              </details>
            )}

            <details className="jb-fold">
              <summary>{t.links.title}</summary>
              <div className="jb-fold-body">
                <p className="crm-muted crm-sm">{t.links.hint}</p>
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
            </details>

            {/* The least-used control here and the only one that changes what
                the business thinks it earned. A practice lead behaves exactly
                like a real one and stays out of every figure on Money. */}
            {isOwner && (
              <details className="jb-fold">
                <summary>
                  Test lead {quote.is_test && <span className="test-pill">Practice</span>}
                </summary>
                <div className="jb-fold-body">
                  <p className="crm-muted crm-sm">
                    {quote.is_test
                      ? "This lead is practice. Payments on it are real rows written by the real code, and none of them count on the Money page."
                      : "Use this on a lead you are testing a feature or a payment with. Nothing about how it behaves changes; it just stops counting as money."}
                  </p>
                  <div className="crm-editor-foot">
                    <form action={setTestFlag}>
                      <input type="hidden" name="id" value={quote.id} />
                      <input type="hidden" name="isTest" value={quote.is_test ? "0" : "1"} />
                      <button type="submit" className="crm-btn crm-btn-ghost">
                        {quote.is_test ? "This is a real job" : "Mark as a test lead"}
                      </button>
                    </form>
                  </div>
                </div>
              </details>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
