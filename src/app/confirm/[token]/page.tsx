import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { getQuoteByToken } from "@/lib/crm/queries";
import { businessName, links, phoneDisplay } from "@/lib/site-data";
import { ConfirmActions } from "./confirm-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Confirm Your Job | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

function prettyDate(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ConfirmJobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  const firstName = quote.name.split(" ")[0];
  const alreadyConfirmed = !!quote.confirmed_at;

  return (
    <main className="cq-wrap">
      <div className="cq-card">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-eyebrow">Confirm Your Job</p>
        </header>

        <h1 className="cq-title">Hi {firstName},</h1>

        {quote.scheduled_date ? (
          <p className="cq-lead">
            Your concrete job is scheduled for{" "}
            <strong>
              {prettyDate(quote.scheduled_date)}
              {quote.scheduled_time ? ` at ${quote.scheduled_time}` : ""}
            </strong>
            . Please confirm you&apos;re still good for that day.
          </p>
        ) : (
          <p className="cq-lead">Please confirm your upcoming concrete job.</p>
        )}

        {alreadyConfirmed ? (
          <div className="cq-result cq-result-ok">
            <p className="cq-result-eyebrow">Confirmed</p>
            <h3>You&apos;re all set. See you then.</h3>
            <p className="cq-result-note">Thanks for confirming. We&apos;ll be in touch if anything comes up.</p>
          </div>
        ) : (
          <ConfirmActions token={token} />
        )}

        <div className="cq-cta">
          <a href={links.call} className="cq-btn cq-btn-primary">
            Call {phoneDisplay}
          </a>
          <a href={links.text} className="cq-btn cq-btn-secondary">
            Text Us
          </a>
        </div>
        <p className="cq-fine">Questions? Just call or text. We&apos;re happy to help.</p>
      </div>
    </main>
  );
}
