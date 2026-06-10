import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { getQuoteByToken } from "@/lib/crm/queries";
import { businessName, links, phoneDisplay } from "@/lib/site-data";
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

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  const hasPrice = quote.quote_amount != null;
  const amount = hasPrice ? `$${Number(quote.quote_amount).toLocaleString("en-US")}` : null;
  const responded = quote.customer_response;

  return (
    <main className="cq-wrap">
      <ViewBeacon token={token} />
      <div className="cq-card">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-eyebrow">Your Concrete Quote</p>
        </header>

        <h1 className="cq-title">Hi {quote.name.split(" ")[0]},</h1>

        {hasPrice ? (
          <>
            <p className="cq-lead">
              Here&apos;s your quote{quote.service ? ` for ${quote.service.toLowerCase()}` : ""}. We&apos;d love to do the work for you.
            </p>
            <div className="cq-price">
              <span className="cq-price-label">Your price</span>
              <span className="cq-price-value">{amount}</span>
            </div>
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
          {responded === "accepted" && quote.scheduled_date && (
            <div>
              <dt>Start date</dt>
              <dd>{prettyDate(quote.scheduled_date)}</dd>
            </div>
          )}
        </dl>

        {quote.quote_summary && (
          <div className="cq-summary">
            <h2>What&apos;s included</h2>
            <p>{quote.quote_summary}</p>
          </div>
        )}

        {/* Decision: show the recorded outcome, or the accept/decline flow */}
        {responded === "accepted" ? (
          <div className="cq-result cq-result-ok">
            <p className="cq-result-eyebrow">Booking confirmed</p>
            <h3>{quote.scheduled_date ? `You're all set for ${prettyDate(quote.scheduled_date)}` : "You're all set"}</h3>
            <p className="cq-result-note">
              We&apos;ll reach out to confirm the details and timing.
              {quote.discount_accepted ? " Your 10% discount is locked in." : ""}
            </p>
          </div>
        ) : responded === "declined" ? (
          <div className="cq-result">
            <p className="cq-result-eyebrow">Quote declined</p>
            <h3>Thanks for letting us know</h3>
            <p className="cq-result-note">Changed your mind? Give us a call or text and we&apos;ll take care of you.</p>
          </div>
        ) : hasPrice ? (
          <QuoteActions token={token} amount={Number(quote.quote_amount)} />
        ) : null}

        <div className="cq-cta">
          <a href={links.call} className="cq-btn cq-btn-primary">
            Call {phoneDisplay}
          </a>
          <a href={links.text} className="cq-btn cq-btn-secondary">
            Text Us
          </a>
        </div>
        <p className="cq-fine">Questions about your quote? Just call or text. We&apos;re happy to walk you through it.</p>
      </div>
    </main>
  );
}
