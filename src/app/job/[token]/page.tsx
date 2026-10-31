import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { firstNameOf, boughtLines, changeStartLines, dollars, requestedVisitOf, STATUS_LABELS, visitDateOf } from "@/lib/crm/constants";
import { BUSINESS_TZ, inQuietHours, todayYmd } from "@/lib/crm/clock";
import { depositDueNowCents, toCents } from "@/lib/crm/fees";
import { crewEventText, quoteSends } from "@/lib/crm/events";
import { dict, intlLocale, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { signMediaPath } from "@/lib/crm/media-token";
import { jobLedger, payeeState } from "@/lib/crm/payments";
import { agreementHeadline, docsLine, shownStatus } from "@/lib/crm/documents";
import { listReceiptsForJob } from "@/lib/crm/receipts";
import { JobDocsLine } from "@/app/crm/quotes/[id]/job-docs-line";
import { getQuoteByToken, listAgreementsForQuote, listEvents, listMessages, listQuoteOptionsAdmin, listQuotePackagesAdmin } from "@/lib/crm/queries";
import { businessName } from "@/lib/site-data";
import { AcceptOffline } from "@/app/crm/quotes/[id]/accept-offline";
import { ChangeOrder } from "@/app/crm/quotes/[id]/change-order";
import { CancelAppointment } from "@/app/crm/quotes/[id]/cancel-appointment";
import { QuoteSends } from "@/app/crm/quotes/[id]/quote-sends";
import { preferredSlots } from "@/app/crm/quotes/[id]/types";
import { JobFinish } from "./job-finish";
import { JobHeldTexts } from "./job-held-texts";
import { JobPayments } from "./job-payments";
import { CrewViewBeacon } from "./crew-view-beacon";
import { bumpCrewView } from "@/lib/crm/crew-views";
import { JobQuote } from "./job-quote";
import { JobReschedule } from "./job-reschedule";
import { JobSchedule } from "./job-schedule";
import { JobVisit } from "./job-visit";
import { methodList, PAYMENT_METHODS } from "@/lib/crm/pay-methods";
import { ONLINE_CARD_PAYMENTS } from "@/lib/crm/stripe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Job Details | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await requireSession(`/crm/login?next=${encodeURIComponent(`/job/${token}`)}`);
  const quote = await getQuoteByToken("job_token", token);
  if (!quote) notFound();
  // Contractors only see jobs assigned to them; owners can see any job.
  if (session.staff.role !== "owner" && quote.assigned_to !== session.staff.id) notFound();
  // Lost or archived: contractors are locked out, and the owner sees they tried.
  if (session.staff.role !== "owner" && (quote.status === "lost" || quote.archived_at)) {
    // Not the refresh straight after they marked it Lost themselves.
    const justChanged = Date.now() - new Date(quote.updated_at ?? 0).getTime() < 2 * 60 * 1000;
    if (!justChanged) await bumpCrewView(quote.id, session.staff.id, true);
    notFound();
  }

  // Queued texts for this job. RLS-scoped, so contractors see only their own jobs'.
  const messages = await listMessages(session, quote.id);
  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const t = dict(locale);
  const base = await crmBase();

  // Which cards appear follows where the job is, so there's one obvious next
  // action. The schedule card sets a first date; after that, only the
  // Reschedule button under the date moves it (two controls breed distrust).
  const accepted = quote.customer_response === "accepted" && quote.status !== "lost";
  const showSchedule = accepted && !quote.scheduled_date;
  const showQuote = !accepted && quote.status !== "lost" && quote.status !== "completed" && quote.status !== "paid";
  const showFinish = quote.status === "scheduled";
  // A verbal yes from a customer who never opened the link. Without it the crew
  // would resend the quote, whose picker starts a week out. Offered on any sent,
  // unanswered quote; acceptOffline explains why the lead-time floor doesn't apply.
  const showOfflineAccept = showQuote && Boolean(quote.quote_sent_at) && quote.quote_amount != null;
  const isDone = quote.status === "completed" || quote.status === "paid";
  // A change to an agreed job, booked or not, so it's written down when the
  // call happens. `accepted` excludes Lost; closed-out jobs are invoice
  // disputes. A pending change keeps the card visible in its waiting state.
  const showChange = accepted && !isDone;
  const pendingChange =
    quote.change_requested_at && quote.change_amount != null
      ? {
          note: quote.change_note ?? "",
          amountCents: toCents(quote.change_amount),
          lines: quote.change_lines,
          depositCents: quote.change_deposit_cents,
        }
      : null;

  // Either a booked in-person visit or an online customer's offered slot.
  const visitDate = visitDateOf(quote);
  // The visit card covers two cases, both ending in a real appointment:
  //   online    photos may not suffice; the customer offered a fallback slot
  //   schedule  an in-person request with no date (cancelled, or never asked)
  // It sits above the quote form, not instead of it: pricing remotely stays
  // available on online jobs.
  const requestedVisit = requestedVisitOf(quote);
  const needsVisitDate = quote.quote_type === "inperson" && !visitDate;
  const showVisit = showQuote && (quote.quote_type === "online" || needsVisitDate);

  // The crew book against their own schedule, so their picker starts today; the
  // lead-time floor is for customers.
  const minJobDate = todayYmd();
  // Independent reads in parallel: sequential awaits were most of the load
  // delay on a phone. Line items use the service role because this page already
  // gates on token + assignment; events use the session (quote_events' policy
  // scopes contractors). Money only once the customer has agreed a number.
  const [options, packages, money, payee, events, receipts, agreements] = await Promise.all([
    listQuoteOptionsAdmin(quote.id),
    listQuotePackagesAdmin(quote.id),
    accepted ? jobLedger(quote) : Promise.resolve(null),
    accepted ? payeeState(quote) : Promise.resolve(null),
    listEvents(session, quote.id),
    listReceiptsForJob(session, quote.id),
    listAgreementsForQuote(session, quote.id),
  ]);
  const cardReady = payee?.ok ?? false;
  const chosen = quote.customer_response === "accepted" ? options.filter((o) => o.customer_response !== "declined") : [];
  // What the customer said they'll pay with, in the standard order.
  const payPlan = accepted ? PAYMENT_METHODS.filter((m) => (quote.customer_pay_methods ?? []).includes(m)) : [];
  const rejected = quote.customer_response === "accepted" ? options.filter((o) => o.customer_response === "declined") : [];
  // The package they picked leads the scope card: it's what goes on the truck.
  const chosenPackage =
    quote.customer_response === "accepted"
      ? (packages.find((p) => p.customer_response === "accepted") ?? null)
      : null;

  // Photos go through the authenticated proxy rather than per-file signed URLs:
  // fewer round-trips, no expiry, and thumbnails instead of 4MB originals.
  // Signed for this contractor, so a pasted URL is refused for anyone else.
  // Width is outside the signature so one covers thumbnail and full size.
  const fileUrl = (path: string, w?: number) =>
    `${base}/api/file?${signMediaPath(path, session.staff.id)}${w ? `&w=${w}` : ""}`;
  const photos = quote.file_urls ?? [];
  // The crew's own uploads, so the finish card shows counts.
  const ourPhotos = [...(quote.internal_urls ?? []), ...(quote.before_urls ?? []), ...(quote.after_urls ?? [])];
  const activity = events
    .map((e) => ({ id: e.id, text: crewEventText(e, t), at: e.created_at }))
    .filter((r): r is { id: string; text: string; at: string } => r.text !== null);
  // Every price this customer has been given, rebuilt from those same events.
  const sends = quoteSends(events, quote.quote_amount);
  // Five fits at a glance; the rest is one tap away.
  const recentActivity = activity.slice(0, 5);
  const earlierActivity = activity.slice(5);

  // Always en-US formatting, regardless of the contractor's locale.
  const fmtDay = (ymd: string) =>
    new Date(`${ymd}T00:00:00`).toLocaleDateString(intlLocale(locale), {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  // Raleigh time, with the hour, so stamps match the phone in hand and "this
  // morning" differs from "last Tuesday".
  const fmtStamp = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: BUSINESS_TZ,
    });
  const prettyVisit = visitDate ? fmtDay(visitDate) : null;
  const prettyJob = quote.scheduled_date ? fmtDay(quote.scheduled_date) : null;

  // The key block: what kind of appointment and when. A booked work day beats
  // a quote visit. An online customer's offered slot comes last, flagged
  // `pending` ("not booked") so nobody drives to it. A booked work day shows a
  // green "Installation scheduled"; confirmed_at is recorded but isn't a warning.
  const isPlans = quote.quote_type === "plans";
  const isInPerson = !isPlans && quote.quote_type !== "online";

  // Once a work day is booked the pill says what the job IS; until then, how
  // it's being quoted.
  const bookedDay = Boolean(quote.scheduled_date) && quote.status !== "lost";
  const pill = bookedDay
    ? {
        text: isDone ? (t.status[quote.status] ?? STATUS_LABELS[quote.status]) : t.contractorJob.jobScheduled,
        tone: isDone ? "done" : "booked",
      }
    : {
        text: isPlans
          ? t.contractorJob.typePlans
          : isInPerson
            ? t.contractorJob.typeInPerson
            : t.contractorJob.typeOnline,
        tone: isPlans ? "plans" : isInPerson ? "inperson" : "online",
      };

  const when = prettyJob
    ? { label: t.contractorJob.scheduledJob, day: prettyJob, time: quote.scheduled_time, pending: false }
    : prettyVisit
      ? { label: t.contractorJob.quoteVisit, day: prettyVisit, time: quote.visit_time, pending: false }
      : requestedVisit
        ? { label: t.contractorJob.visitAsked, day: fmtDay(requestedVisit), time: quote.visit_time, pending: true }
        : null;

  // Reschedule moves whichever appointment the block shows. An offered slot
  // isn't an appointment (that's the visit card's job); finished or lost jobs
  // have nothing to move.
  const reschedule =
    isDone || quote.status === "lost"
      ? null
      : quote.scheduled_date
        ? ({ kind: "job", date: quote.scheduled_date, time: quote.scheduled_time } as const)
        : visitDate
          ? ({ kind: "visit", date: visitDate, time: quote.visit_time } as const)
          : null;

  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  return (
    <main className="job-wrap">
      {session.staff.role !== "owner" && <CrewViewBeacon token={token} />}
      <div className="job-card">
        <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="job-logo" priority />

        <div className="job-head">
          <h1 className="job-title">{t.contractorJob.title}</h1>
          {/* Hidden once a work day is booked, since the pill then carries the
              stage. Other stages have nothing else announcing them. */}
          {!bookedDay && (
            <span className={`crm-badge crm-badge-${quote.status}`}>
              {t.status[quote.status] ?? STATUS_LABELS[quote.status]}
            </span>
          )}
        </div>
        <Link href={`${base}/`} className="job-back">
          {t.contractorJob.backToJobs}
        </Link>
        {/* The quote as the customer got it, at any stage: for resending, or the truck. */}
        {quote.quote_amount != null && (
          <a href={`/crm/api/quote-pdf?id=${quote.id}`} className="job-back job-pdf">
            {t.contractorJob.downloadPdf}
          </a>
        )}

        {/* Read at arm's length outdoors: large and heavy, emphasis by size, not colour. */}
        <div className="job-key">
          <span className={`job-type job-type-${pill.tone}`}>{pill.text}</span>
          {when ? (
            <div className={`job-when${when.pending ? " job-when-pending" : ""}`}>
              <span className="job-when-label">{when.label}</span>
              <strong className="job-when-day">{when.day}</strong>
              {when.time && <strong className="job-when-time">{when.time}</strong>}
              {when.pending && <span className="job-when-tag">{t.contractorJob.visitNotBooked}</span>}
            </div>
          ) : (
            // Nothing is missing: online quotes need no date unless the photos
            // fall short, and plans jobs never get a visit.
            <span className="job-when-none">
              {isPlans
                ? t.contractorJob.priceFromPlans
                : quote.quote_type === "online"
                  ? t.contractorJob.noVisitNeeded
                  : t.contractorJob.notScheduled}
            </span>
          )}

          {/* Here because the date is what it changes; one button so a settled job reads settled. */}
          {reschedule && (
            <>
              <JobReschedule
                id={quote.id}
                kind={reschedule.kind}
                date={reschedule.date}
                time={reschedule.time}
                minDate={minJobDate}
                locale={locale}
              />
              {/* The other answer to "I can't make it". The text is optional:
                  the customer is often still on the phone. */}
              <CancelAppointment
                id={quote.id}
                kind={reschedule.kind}
                customerName={quote.name}
                locale={locale}
              />
            </>
          )}
        </div>

        {/* Above everything: an unsent text is the customer not knowing
            something we think they know. Renders nothing when the queue is empty. */}
        <JobHeldTexts quoteId={quote.id} messages={messages} quiet={inQuietHours()} locale={locale} />

        {/* Appointment cards first: time-critical and self-contained. Pricing
            needs the photos and notes, so it's at the bottom. Cards depend on stage. */}
        {showSchedule && (
          <JobSchedule
            id={quote.id}
            preferred={preferredSlots(quote.preferred_dates, quote.preferred_times)}
            minDate={minJobDate}
            locale={locale}
          />
        )}

        {showVisit && (
          <JobVisit
            id={quote.id}
            mode={needsVisitDate ? "schedule" : "online"}
            requestedDate={requestedVisit}
            requestedTime={quote.visit_time}
            minDate={minJobDate}
            locale={locale}
          />
        )}

        {showOfflineAccept && (
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
            tone="light"
          />
        )}

        {/* With the appointment cards: on a booked job it's the likeliest reason
            the crew are here, so it mustn't sit below the photos. */}
        {showChange && money && (
          <ChangeOrder
            id={quote.id}
            customerName={quote.name}
            totalCents={money.ledger.totalCents}
            paidCents={money.ledger.paidCents}
            // The crew recorded these, so they check them before a balance goes out.
            payments={money.rows.map((r) => ({
              id: r.id,
              method: r.method,
              amountCents: r.amount_cents,
              netCents: r.amount_cents - r.refunded_cents,
              status: r.status,
              when: r.paid_at ?? r.created_at,
              note: r.note,
            }))}
            bookedFor={prettyJob ? `${prettyJob}${quote.scheduled_time ? ` ${t.contractorJob.at} ${quote.scheduled_time}` : ""}` : null}
            workCompleted={Boolean(quote.completed_at)}
            pending={pendingChange}
            // Starts from the lines the customer agreed. Package jobs stay one figure.
            lines={changeStartLines(boughtLines(options), quote.quote_amount, quote.service)}
            jobHasLines={boughtLines(options).length > 0}
            canBreakDown={packages.length === 0}
            canApplyAgreed={session.staff.role === "owner"}
            locale={locale}
            tone="light"
          />
        )}

        {showFinish && (
          <JobFinish
            id={quote.id}
            locale={locale}
            beforeCount={quote.before_urls?.length ?? 0}
            afterCount={quote.after_urls?.length ?? 0}
          />
        )}

        {isDone && (
          <section className="js-card jf-done">
            <h2 className="js-title">{t.contractorJob.doneTitle}</h2>
            <p className="js-lead">{t.contractorJob.doneNote}</p>
          </section>
        )}

        {/* Below the close-out card: on a finished job that was the last step. */}
        {money && (
          <JobPayments
            id={quote.id}
            locale={locale}
            cardReady={cardReady}
            onlineCard={ONLINE_CARD_PAYMENTS}
            totalCents={money.ledger.totalCents}
            paidCents={money.ledger.paidCents}
            dueCents={money.ledger.dueCents}
            dueNowCents={depositDueNowCents(quote.deposit_target_cents, money.ledger.paidCents, money.ledger.dueCents)}
            feeTotalCents={money.ledger.feeTotalCents}
            feeRate={money.rate}
            feeRateFrozen={quote.fee_rate != null}
            feeCollectedCents={money.ledger.feeCollectedCents}
            feeDueCents={money.ledger.feeDueNowCents}
            feeSettledCents={money.ledger.feeSettledCents}
            feeWaivedCents={money.ledger.feeWaivedCents}
            rows={money.rows.map((r) => ({
              id: r.id,
              method: r.method,
              amount_cents: r.amount_cents,
              refunded_cents: r.refunded_cents,
              status: r.status,
              paid_at: r.paid_at,
              created_at: r.created_at,
              fee_cents: r.fee_cents,
            }))}
          />
        )}
        {(receipts.length > 0 || agreements.length > 0) && (
          <JobDocsLine
            href={`${base}/documents/${quote.id}`}
            line={docsLine({
              agreement: agreementHeadline(agreements.map(shownStatus)),
              receipts: receipts.filter((r) => !r.voided_at).length,
            })}
            tone="light"
          />
        )}

        {/* How the customer said they'll pay: the boxes they ticked when signing the agreement. */}
        {payPlan.length > 0 && (
          <section className="js-card jo-payplan">
            <h2 className="js-title">{t.contractorJob.payPlan}</h2>
            <p className="jo-payplan-list">{methodList(payPlan)}</p>
            <p className="js-hint">{t.contractorJob.payPlanHint}</p>
          </section>
        )}

        {/* What they bought, above customer details: on an options quote it
            decides what goes on the truck. Only after they answer. */}
        {(chosen.length > 0 || chosenPackage) && (
          <section className="js-card jo-scope">
            <h2 className="js-title">{t.contractorJob.approvedScope}</h2>
            <p className="js-hint">{t.contractorJob.approvedScopeHint}</p>
            <ul className="jo-scope-list">
              {/* The chosen package, marked: read as one more line item, the
                  wrong one turns up on the truck. */}
              {chosenPackage && (
                <li className="jo-scope-pick">
                  <strong>{chosenPackage.title}</strong>
                  <span>{dollars(Number(chosenPackage.amount))}</span>
                  {chosenPackage.description && <em>{chosenPackage.description}</em>}
                </li>
              )}
              {chosen.map((o) => (
                <li key={o.id}>
                  <strong>{o.title}</strong>
                  <span>{dollars(Number(o.amount))}</span>
                  {o.description && <em>{o.description}</em>}
                </li>
              ))}
            </ul>
            {rejected.length > 0 && (
              <p className="js-hint jo-scope-no">
                {t.contractorJob.turnedDown}: {rejected.map((o) => o.title).join(", ")}
              </p>
            )}
          </section>
        )}

        <dl className="job-meta">
          <div>
            <dt>{t.contractorJob.customer}</dt>
            <dd>{quote.name}</dd>
          </div>
          <div>
            <dt>{t.contractorJob.phone}</dt>
            <dd>
              <a href={`tel:${quote.phone.replace(/[^0-9+]/g, "")}`}>{quote.phone}</a>
            </dd>
          </div>
          {quote.service && (
            <div>
              <dt>{t.contractorJob.service}</dt>
              <dd>{quote.service}</dd>
            </div>
          )}
          {quote.address && (
            <div>
              <dt>{t.contractorJob.address}</dt>
              <dd>
                {quote.address}
                {mapsLink && (
                  <>
                    {" · "}
                    <a href={mapsLink} target="_blank" rel="noreferrer">
                      {t.contractorJob.openInMaps}
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
          {/* The live appointment is in the top block. This still shows the
              visit on a booked job, which the block has no room for. */}
          {prettyJob && prettyVisit && (
            <div>
              <dt>{t.contractorJob.quoteVisit}</dt>
              <dd>
                {prettyVisit}
                {quote.visit_time ? ` ${t.contractorJob.at} ${quote.visit_time}` : ""}
              </dd>
            </div>
          )}
          {!prettyVisit && quote.preferred_time && (
            <div>
              <dt>{t.contractorJob.preferredTime}</dt>
              <dd>{quote.preferred_time}</dd>
            </div>
          )}
        </dl>

        {quote.details && (
          <div className="job-details">
            <h2>{t.contractorJob.projectNotes}</h2>
            <p>{quote.details}</p>
          </div>
        )}

        <h2 className="job-photos-title">{t.contractorJob.photos} ({photos.length})</h2>
        {photos.length === 0 ? (
          <p className="job-muted">{t.contractorJob.noFiles}</p>
        ) : (
          <div className="job-photos">
            {photos.map((path) => (
              <a key={path} href={fileUrl(path)} target="_blank" rel="noreferrer" className="job-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(path, 640)} alt={t.misc.jobPhoto} loading="lazy" decoding="async" width={640} height={640} />
              </a>
            ))}
          </div>
        )}

        {/* The crew's own uploads, visible without opening the finish card. */}
        {ourPhotos.length > 0 && (
          <>
            <h2 className="job-photos-title">{t.contractorJob.ourPhotos} ({ourPhotos.length})</h2>
            <div className="job-photos">
              {ourPhotos.map((path) => (
                <a key={path} href={fileUrl(path)} target="_blank" rel="noreferrer" className="job-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(path, 640)} alt={t.misc.jobPhoto} loading="lazy" decoding="async" width={640} height={640} />
                </a>
              ))}
            </div>
          </>
        )}

        {/* Pricing last: it needs the photos, notes and address above. */}
        {showQuote && (
          <JobQuote
            id={quote.id}
            locale={locale}
            amount={quote.quote_amount}
            summary={quote.quote_summary}
            options={options.map((o) => ({
              id: o.id,
              title: o.title,
              description: o.description,
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
            initialSections={{
              quote_scope: quote.quote_scope,
              quote_permits: quote.quote_permits,
              quote_prep: quote.quote_prep,
              quote_pour: quote.quote_pour,
              quote_cleanup: quote.quote_cleanup,
              estimated_duration: quote.estimated_duration,
            }}
            alreadySent={Boolean(quote.quote_sent_at)}
            // Sent and unanswered: the card says to wait rather than offer a resend.
            awaitingReply={Boolean(quote.quote_sent_at) && !quote.customer_response}
            sentAt={quote.quote_sent_at}
            customerFirstName={firstNameOf(quote.name, quote.name)}
            service={quote.service}
          />
        )}

        {/* What the customer has been quoted ("which number are they looking
            at"), above the full history. */}
        <QuoteSends
          quoteId={quote.id}
          customerName={quote.name}
          sends={sends}
          canRetract={session.staff.role === "owner"}
          canAddOption={showQuote && Boolean(quote.quote_sent_at)}
          currentAmount={quote.quote_amount}
          service={quote.service}
          options={packages.map((p) => ({ id: p.id, title: p.title, amount: Number(p.amount), recommended: p.recommended }))}
          locale={locale}
          tone="light"
        />

        {/* Last: nothing depends on it. Has the customer seen it, said yes, who
            moved the day. Newest first. */}
        <section className="job-log">
          <h2 className="job-photos-title">{t.contractorJob.logTitle}</h2>
          {activity.length === 0 ? (
            <p className="job-muted">{t.contractorJob.logEmpty}</p>
          ) : (
            <>
              <ol className="job-log-list">
                {recentActivity.map((r) => (
                  <li key={r.id}>
                    <strong>{r.text}</strong>
                    <span>{fmtStamp(r.at)}</span>
                  </li>
                ))}
              </ol>
              {earlierActivity.length > 0 && (
                <details className="job-log-more">
                  <summary>
                    {t.contractorJob.logMore} ({earlierActivity.length})
                  </summary>
                  <ol className="job-log-list">
                    {earlierActivity.map((r) => (
                      <li key={r.id}>
                        <strong>{r.text}</strong>
                        <span>{fmtStamp(r.at)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
