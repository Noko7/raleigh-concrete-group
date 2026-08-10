import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { STATUS_LABELS, requestedVisitOf, visitDateOf } from "@/lib/crm/constants";
import { dict, isLocale } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { getQuoteByToken, signFiles } from "@/lib/crm/queries";
import { businessName } from "@/lib/site-data";
import { JobFinish } from "./job-finish";
import { JobQuote } from "./job-quote";
import { JobSchedule } from "./job-schedule";
import { JobVisit } from "./job-visit";

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

  const locale = isLocale(session.staff.locale) ? session.staff.locale : "en";
  const t = dict(locale);
  const base = await crmBase();

  // This page is the crew's whole job: quote it, schedule it, finish it. Which
  // cards appear is driven by where the job actually is, so there's only ever
  // one obvious next action on screen.
  const showSchedule = quote.customer_response === "accepted" && quote.status !== "lost";
  const showQuote = !showSchedule && quote.status !== "lost" && quote.status !== "completed" && quote.status !== "paid";
  const showFinish = quote.status === "scheduled";
  const isDone = quote.status === "completed" || quote.status === "paid";

  // The same column read two ways: a booked appointment on an in-person request,
  // or the slot an online customer offered in case photos aren't enough.
  const visitDate = visitDateOf(quote);
  // The visit card covers two different situations, both of which end in the
  // crew putting a real appointment on the calendar:
  //
  //   online    they haven't decided whether the photos are enough, and the
  //             customer offered a slot in case they aren't
  //   schedule  an in-person request with no date on the books - either the
  //             visit was cancelled off the calendar or it predates the form
  //             asking - so somebody has to pick one
  //
  // It sits above the quote form rather than instead of it: on an online job,
  // pricing it remotely is still the faster path and stays available below.
  const requestedVisit = requestedVisitOf(quote);
  const needsVisitDate = quote.quote_type === "inperson" && !visitDate;
  const showVisit = showQuote && (quote.quote_type === "online" || needsVisitDate);

  // The crew books against their own schedule, so their picker starts today.
  // The 7-day floor applies to what a customer may request, not to what the
  // people doing the work are allowed to agree to.
  const minJobDate = new Date().toISOString().slice(0, 10);
  const photos = quote.file_urls?.length ? await signFiles(quote.file_urls, 7200) : [];

  // Dates read in the contractor's own language, same as the rest of the page.
  const fmtDay = (ymd: string) =>
    new Date(`${ymd}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  const prettyVisit = visitDate ? fmtDay(visitDate) : null;
  const prettyJob = quote.scheduled_date ? fmtDay(quote.scheduled_date) : null;

  // The two things a contractor needs off this page in one glance, standing
  // outside holding a phone: what kind of appointment this is, and when it is.
  // A booked work day always wins over a quote visit - once the job is on, the
  // visit that produced it stops being the thing they're driving to.
  //
  // An online request's offered slot comes last and is flagged `pending`, which
  // renders it in a different colour with "not confirmed" on it. A date shown
  // the same way as a booking is a date somebody drives to.
  const isInPerson = quote.quote_type === "inperson";
  const when = prettyJob
    ? { label: t.contractorJob.scheduledJob, day: prettyJob, time: quote.scheduled_time, pending: false }
    : prettyVisit
      ? { label: t.contractorJob.quoteVisit, day: prettyVisit, time: quote.visit_time, pending: false }
      : requestedVisit
        ? {
            label: t.contractorJob.visitAsked,
            day: fmtDay(requestedVisit),
            time: quote.visit_time,
            pending: true,
          }
        : null;

  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  return (
    <main className="job-wrap">
      <div className="job-card">
        <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="job-logo" priority />

        <div className="job-head">
          <h1 className="job-title">{t.contractorJob.title}</h1>
          <span className={`crm-badge crm-badge-${quote.status}`}>{t.status[quote.status] ?? STATUS_LABELS[quote.status]}</span>
        </div>
        <Link href={`${base}/`} className="job-back">
          {t.contractorJob.backToJobs}
        </Link>

        {/* Read on a phone at arm's length, often outdoors, so these two facts
            are set large and heavy. They shout through size rather than through
            a colour of their own - this is one card in a stack, not a banner. */}
        <div className="job-key">
          <span className={`job-type job-type-${isInPerson ? "inperson" : "online"}`}>
            {isInPerson ? t.contractorJob.typeInPerson : t.contractorJob.typeOnline}
          </span>
          {when ? (
            <div className={`job-when${when.pending ? " job-when-pending" : ""}`}>
              <span className="job-when-label">{when.label}</span>
              <strong className="job-when-day">{when.day}</strong>
              {when.time && <strong className="job-when-time">{when.time}</strong>}
              {when.pending && <span className="job-when-tag">{t.contractorJob.visitNotConfirmed}</span>}
            </div>
          ) : (
            // "No date set yet" on an online quote reads like something is
            // missing. Nothing is: they didn't offer a time and none is needed
            // unless the photos fall short.
            <span className="job-when-none">
              {quote.quote_type === "online" ? t.contractorJob.noVisitNeeded : t.contractorJob.notScheduled}
            </span>
          )}
        </div>

        {/* Appointments go at the top: they're the time-critical decisions and
            they need nothing from further down the page. Pricing is the one
            action that does need the photos and notes below, so it waits at the
            bottom rather than sitting here asking for a number you can't give
            yet. Which cards appear depends on the stage. */}
        {showSchedule && (
          <JobSchedule
            id={quote.id}
            scheduledDate={quote.scheduled_date}
            scheduledTime={quote.scheduled_time}
            preferredDates={quote.preferred_dates ?? []}
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

        {showFinish && <JobFinish id={quote.id} locale={locale} />}

        {isDone && (
          <section className="js-card jf-done">
            <h2 className="js-title">{t.contractorJob.doneTitle}</h2>
            <p className="js-lead">{t.contractorJob.doneNote}</p>
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
          {/* The work day and the visit are in the block at the top of the
              page, so they're not repeated here. This one still shows the
              visit when a job is booked, since the block only has room for
              whichever is the live appointment. */}
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
            {photos.map((p) =>
              p.url ? (
                <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="job-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="Job upload" loading="lazy" />
                </a>
              ) : null,
            )}
          </div>
        )}

        {/* Pricing goes last on purpose. It needs the photos, the notes and the
            address that sit above it, so putting it here means reading the job
            and then quoting it, rather than scrolling past the form twice. */}
        {showQuote && (
          <JobQuote
            id={quote.id}
            locale={locale}
            amount={quote.quote_amount}
            summary={quote.quote_summary}
            alreadySent={Boolean(quote.quote_sent_at)}
            customerFirstName={quote.name.trim().split(/\s+/)[0] || quote.name}
          />
        )}
      </div>
    </main>
  );
}
