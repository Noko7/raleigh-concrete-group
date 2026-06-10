import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getQuoteByToken } from "@/lib/crm/queries";
import { businessName, links, phoneDisplay } from "@/lib/site-data";
import { ViewBeacon } from "./view-beacon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Your Quote | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

export default async function CustomerQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  const hasPrice = quote.quote_amount != null;
  const amount = hasPrice ? `$${Number(quote.quote_amount).toLocaleString("en-US")}` : null;

  return (
    <main className="cq-wrap">
      <ViewBeacon token={token} />
      <div className="cq-card">
        <header className="cq-head">
          <p className="cq-brand">{businessName}</p>
          <p className="cq-eyebrow">Your Concrete Quote</p>
        </header>

        <h1 className="cq-title">Hi {quote.name.split(" ")[0]},</h1>

        {hasPrice ? (
          <>
            <p className="cq-lead">Here&apos;s your quote{quote.service ? ` for ${quote.service.toLowerCase()}` : ""}. We&apos;d love to do the work for you.</p>
            <div className="cq-price">
              <span className="cq-price-label">Your price</span>
              <span className="cq-price-value">{amount}</span>
            </div>
          </>
        ) : (
          <p className="cq-lead">Thanks for reaching out. We&apos;re putting your quote together and will have your price here shortly.</p>
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
