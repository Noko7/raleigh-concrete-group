import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { requireSession } from "@/lib/crm/auth";
import { LEAD_TIME_DAYS } from "@/lib/crm/constants";
import { dict, isLocale } from "@/lib/crm/i18n";
import { getQuoteByToken, signFiles } from "@/lib/crm/queries";
import { businessName } from "@/lib/site-data";
import { JobSchedule } from "./job-schedule";

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
  // Scheduling appears once the customer has approved; before that there's
  // nothing for the crew to confirm.
  const showSchedule = quote.customer_response === "accepted" && quote.status !== "lost";
  const minJobDate = new Date(Date.now() + LEAD_TIME_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const photos = quote.file_urls?.length ? await signFiles(quote.file_urls, 7200) : [];
  const prettyVisit = quote.visit_date
    ? new Date(`${quote.visit_date}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;
  const prettyJob = quote.scheduled_date
    ? new Date(`${quote.scheduled_date}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;
  const mapsLink = quote.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quote.address)}`
    : null;

  return (
    <main className="job-wrap">
      <div className="job-card">
        <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="job-logo" priority />
        <h1 className="job-title">{t.contractorJob.title}</h1>

        {/* The one action this page exists for goes first - a contractor opening
            this from a text is here to confirm the day, not to scroll. */}
        {showSchedule && (
          <JobSchedule
            id={quote.id}
            scheduledDate={quote.scheduled_date}
            preferredDates={quote.preferred_dates ?? []}
            minDate={minJobDate}
            locale={locale}
          />
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
          {prettyJob && (
            <div>
              <dt>{t.contractorJob.scheduledJob}</dt>
              <dd>
                <strong>{prettyJob}</strong>
              </dd>
            </div>
          )}
          {prettyVisit && (
            <div>
              <dt>{t.contractorJob.quoteVisit}</dt>
              <dd>
                <strong>{prettyVisit}</strong>
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
      </div>
    </main>
  );
}
