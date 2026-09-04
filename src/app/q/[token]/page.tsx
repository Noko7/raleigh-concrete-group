import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import {
  DECLINE_CREDIT,
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_LABELS,
  QUOTE_TTL_DAYS,
} from "@/lib/crm/constants";
import { getQuoteByToken, isQuoteExpired, listQuoteOptionsAdmin } from "@/lib/crm/queries";
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

  // Line items, if this quote was written as a list of choices. Fetched before
  // the expired/responded branches below use them.
  const options = (await listQuoteOptionsAdmin(quote.id)).map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description,
    amount: Number(o.amount),
    required: o.required,
    customer_response: o.customer_response,
  }));
  const itemised = options.length > 0;

  const hasPrice = quote.quote_amount != null;
  const amount = hasPrice ? `$${Number(quote.quote_amount).toLocaleString("en-US")}` : null;
  const responded = quote.customer_response;
  const firstName = quote.name.split(" ")[0];

  // Only the sections that were actually filled in. An owner can't send a
  // quote with one blank, but a draft viewed early can have gaps and a
  // half-empty list reads worse than the old single block.
  const sections = QUOTE_SECTION_FIELDS.map((f) => [f, quote[f]] as const).filter(
    (pair): pair is readonly [(typeof QUOTE_SECTION_FIELDS)[number], string] =>
      Boolean(pair[1] && pair[1].trim()),
  );

  // ── The offer ran out ──
  // Shown instead of the price, never alongside it: a number on screen next
  // to "this has expired" is an invitation to argue about whether it still
  // stands. Recovering is one phone call, and re-sending the quote from the
  // CRM puts a fresh seven days on this same link.
  if (isQuoteExpired(quote)) {
    return (
      <main className="cq-wrap">
        <div className="cq-confirm">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-confirm-eyebrow cq-confirm-eyebrow-muted">Quote expired</p>
          <h1 className="cq-confirm-title">Hi {firstName}, this quote has expired.</h1>
          <p className="cq-confirm-note">
            Quotes are good for {QUOTE_TTL_DAYS} days so our pricing stays accurate. Give us a call or send a text and
            we&apos;ll get an updated one out to you the same day.
          </p>
          <ContactButtons />
        </div>
      </main>
    );
  }

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
          {/* What they approved, item by item. This page is their record of the
              job from here on, and on a quote with options "approved" on its
              own doesn't say which ones. */}
          {itemised && (
            <ul className="cq-confirm-items">
              {options
                .filter((o) => o.customer_response !== "declined")
                .map((o) => (
                  <li key={o.id}>
                    <span>{o.title}</span>
                    <strong>${o.amount.toLocaleString("en-US")}</strong>
                  </li>
                ))}
              {options
                .filter((o) => o.customer_response === "declined")
                .map((o) => (
                  <li key={o.id} className="cq-confirm-item-no">
                    <span>{o.title}</span>
                    <strong>Not included</strong>
                  </li>
                ))}
            </ul>
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
              {itemised
                ? "Here's your quote. Some of it is up to you - say yes or no to each option below and your total updates as you go."
                : `Here's your quote${quote.service ? ` for ${quote.service.toLowerCase()}` : ""}. We'd love to do the work for you.`}
            </p>
            {/* On an itemised quote there is no single price to print here: the
                number depends on what they pick, so it lives with the options
                and moves as they answer. One price on the page, never two. */}
            {!itemised && (
              <div className="cq-price">
                <span className="cq-price-label">Your price, all in</span>
                <span className="cq-price-value">{amount}</span>
                <span className="cq-price-sub">Free quote · no obligation until you approve</span>
                {/* Under the price, because that is what the deadline is
                    actually about. Only shown once the quote has been sent -
                    a draft has no clock running. */}
                {quote.quote_expires_at && (
                  <span className="cq-expiry">Good through {prettyDate(quote.quote_expires_at.slice(0, 10))}</span>
                )}
              </div>
            )}
            {itemised && quote.quote_expires_at && (
              <p className="cq-expiry cq-expiry-line">
                Good through {prettyDate(quote.quote_expires_at.slice(0, 10))}
              </p>
            )}
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

        {/* The five sections, in a fixed order, so every quote we send
            answers the same questions in the same places. Quotes written
            before the sections existed fall back to their old free text
            rather than showing the customer an empty panel. */}
        {sections.length > 0 ? (
          <div className="cq-summary">
            <h2>What&apos;s included</h2>
            <dl className="cq-sections">
              {sections.map(([field, value]) => (
                <div key={field} className="cq-section">
                  <dt>{QUOTE_SECTION_LABELS[field]}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          quote.quote_summary && (
            <div className="cq-summary">
              <h2>What&apos;s included</h2>
              <p>{quote.quote_summary}</p>
            </div>
          )
        )}

        {hasPrice ? (
          <QuoteActions
            token={token}
            amount={Number(quote.quote_amount)}
            options={options.map((o) => ({
              id: o.id,
              title: o.title,
              description: o.description,
              amount: o.amount,
              required: o.required,
            }))}
          />
        ) : null}

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
