import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { getQuoteByToken, signFiles } from "@/lib/crm/queries";
import { businessName } from "@/lib/site-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Job Details | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken("job_token", token);
  if (!quote) notFound();

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
        <h1 className="job-title">Job Details</h1>

        <dl className="job-meta">
          <div>
            <dt>Customer</dt>
            <dd>{quote.name}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${quote.phone.replace(/[^0-9+]/g, "")}`}>{quote.phone}</a>
            </dd>
          </div>
          {quote.service && (
            <div>
              <dt>Service</dt>
              <dd>{quote.service}</dd>
            </div>
          )}
          {quote.address && (
            <div>
              <dt>Address</dt>
              <dd>
                {quote.address}
                {mapsLink && (
                  <>
                    {" · "}
                    <a href={mapsLink} target="_blank" rel="noreferrer">
                      Open in Maps
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
          {prettyJob && (
            <div>
              <dt>Scheduled job</dt>
              <dd>
                <strong>{prettyJob}</strong>
              </dd>
            </div>
          )}
          {prettyVisit && (
            <div>
              <dt>Quote visit</dt>
              <dd>
                <strong>{prettyVisit}</strong>
                {quote.visit_time ? ` at ${quote.visit_time}` : ""}
              </dd>
            </div>
          )}
          {!prettyVisit && quote.preferred_time && (
            <div>
              <dt>Preferred time</dt>
              <dd>{quote.preferred_time}</dd>
            </div>
          )}
        </dl>

        {quote.details && (
          <div className="job-details">
            <h2>Project notes</h2>
            <p>{quote.details}</p>
          </div>
        )}

        <h2 className="job-photos-title">Photos &amp; video ({photos.length})</h2>
        {photos.length === 0 ? (
          <p className="job-muted">No files were uploaded for this job.</p>
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
