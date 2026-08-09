import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { DECLINE_CREDIT } from "@/lib/crm/constants";
import { getQuoteByToken } from "@/lib/crm/queries";
import { businessName, links, phoneDisplay, testimonials } from "@/lib/site-data";
import { QuoteActions } from "./quote-actions";
import { ViewBeacon } from "./view-beacon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Your Quote | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

function prettyDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}

function ContactButtons() {
  return (
    <div className="cq-cta">
      <a href={links.call} className="cq-btn cq-btn-primary">
        Call {phoneDisplay}
      </a>
      <a href={links.text} className="cq-btn cq-btn-secondary">
        Text Us
      </a>
    </div>
  );
}

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  const hasPrice = quote.quote_amount != null;
  const amount = hasPrice ? `$${Number(quote.quote_amount).toLocaleString("en-US")}` : null;
  const responded = quote.customer_response;
  const firstName = quote.name.split(" ")[0];

  // ── Full-screen confirmation once the customer has responded ──
  if (responded === "accepted") {
    // Approving no longer books a day - the crew confirms one of the customer's
    // preferred days first. Until then this must not claim a date is locked in.
    const awaitingDate = !quote.scheduled_date;
    const preferred = (quote.preferred_dates ?? []).filter(Boolean);
    return (
      <main className="cq-wrap">
        <ViewBeacon token={token} />
        <div className="cq-confirm cq-confirm-ok">
          <div className="cq-confirm-badge">
            <CheckMark />
          </div>
          <p className="cq-confirm-eyebrow">{awaitingDate ? "Quote Approved" : "Booking Confirmed"}</p>
          <h1 className="cq-confirm-title">
            {awaitingDate ? "Thanks" : "You're all set"}
            {firstName ? `, ${firstName}` : ""}!
          </h1>
          {awaitingDate ? (
            <p className="cq-confirm-date">
              We&apos;re checking the crew&apos;s schedule and will text you to confirm your installation date.
              {preferred.length > 0 && (
                <>
                  {" "}
                  You told us these work: <strong>{preferred.map((d) => prettyDate(d)).join(", ")}</strong>.
                </>
              )}
            </p>
          ) : (
            <p className="cq-confirm-date">
              We&apos;ve got you booked for{" "}
              <strong>
                {prettyDate(quote.scheduled_date as string)}
                {quote.scheduled_time ? ` at ${quote.scheduled_time}` : ""}
              </strong>
            </p>
          )}
          {amount && (
            <div className="cq-confirm-price">
              {quote.discount_accepted && <span className="cq-confirm-save">${DECLINE_CREDIT} credit applied</span>}
              <span>{amount}</span>
            </div>
          )}
          <p className="cq-confirm-note">
            {awaitingDate
              ? "If none of those days end up working, we'll call you to find one that does. Thanks for choosing Raleigh Concrete Group."
              : "We'll text a reminder before we arrive. Thanks for choosing Raleigh Concrete Group."}
          </p>
          <ContactButtons />
          <Image
            src="/images/logo_horizontal.png"
            alt={businessName}
            width={967}
            height={243}
            className="cq-confirm-logo"
            priority
          />
        </div>
      </main>
    );
  }

  if (responded === "declined") {
    return (
      <main className="cq-wrap">
        <ViewBeacon token={token} />
        <div className="cq-confirm">
          <p className="cq-confirm-eyebrow cq-confirm-eyebrow-muted">Quote Declined</p>
          <h1 className="cq-confirm-title">Thanks for letting us know{firstName ? `, ${firstName}` : ""}</h1>
          <p className="cq-confirm-note">
            No hard feelings. If anything changes, we&apos;re a quick call or text away and we&apos;d still love to help.
          </p>
          <ContactButtons />
          <Image
            src="/images/logo_horizontal.png"
            alt={businessName}
            width={967}
            height={243}
            className="cq-confirm-logo"
            priority
          />
        </div>
      </main>
    );
  }

  // ── Default: the quote with accept / decline actions ──
  return (
    <main className="cq-wrap">
      <ViewBeacon token={token} />
      <div className="cq-card">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-eyebrow">Your Concrete Quote</p>
        </header>

        <h1 className="cq-title">Hi {firstName},</h1>

        {hasPrice ? (
          <>
            <p className="cq-lead">
              Here&apos;s your quote{quote.service ? ` for ${quote.service.toLowerCase()}` : ""}. We&apos;d love to do the work for you.
            </p>
            <div className="cq-price">
              <span className="cq-price-label">Your price, all in</span>
              <span className="cq-price-value">{amount}</span>
              <span className="cq-price-sub">Free quote · no obligation until you approve</span>
            </div>
            {/* Trust markers echo the site's own published copy (clear pricing,
                on time, local) - no warranty or licensing claims per business
                policy in site-data.ts. */}
            <ul className="cq-trust">
              <li>Local Raleigh crew</li>
              <li>Clear pricing, no surprises</li>
              <li>We show up when we say</li>
            </ul>
          </>
        ) : (
          <p className="cq-lead">
            Thanks for reaching out. We&apos;re putting your quote together and will have your price here shortly.
          </p>
        )}

        <dl className="cq-meta">
          {quote.service && (
            <div>
              <dt>Service</dt>
              <dd>{quote.service}</dd>
            </div>
          )}
          {quote.address && (
            <div>
              <dt>Address</dt>
              <dd>{quote.address}</dd>
            </div>
          )}
        </dl>

        {quote.quote_summary && (
          <div className="cq-summary">
            <h2>What&apos;s included</h2>
            <p>{quote.quote_summary}</p>
          </div>
        )}

        {hasPrice ? <QuoteActions token={token} amount={Number(quote.quote_amount)} /> : null}

        {/* One real review from the site's testimonials, right below the
            decision point - the moment a nervous customer looks for a reason
            to trust the number above. */}
        {hasPrice && (
          <blockquote className="cq-review">
            <p>&ldquo;{testimonials[0].quote}&rdquo;</p>
            <footer>
              {testimonials[0].name}, {testimonials[0].city}
            </footer>
          </blockquote>
        )}

        <ContactButtons />
        <p className="cq-fine">Questions about your quote? Just call or text. We&apos;re happy to walk you through it.</p>
      </div>
    </main>
  );
}
