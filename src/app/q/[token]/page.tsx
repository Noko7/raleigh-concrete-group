import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { firstNameOf, DECLINE_CREDIT, dollars, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, QUOTE_TTL_DAYS, slotsFor } from "@/lib/crm/constants";
import { depositDueNowCents, toCents, usd } from "@/lib/crm/fees";
import { jobLedger, payeeState } from "@/lib/crm/payments";
import { getQuoteByToken, getWorkHours, isOpenAgain, isQuoteExpired, listQuoteOptionsAdmin, listQuotePackagesAdmin } from "@/lib/crm/queries";
import { businessName, testimonials } from "@/lib/site-data";
import { ChangeReview } from "./change-review";
import { QuoteActions } from "./quote-actions";
import { ContactButtons } from "@/components/contact-buttons";
import { QuoteSections } from "@/components/quote-sections";
import { PreviewGuard } from "./preview-guard";
import { ViewBeacon } from "./view-beacon";
import { jobPayMethods } from "@/lib/crm/queries/responses";

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

export default async function CustomerQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  // The office's preview from the job page: not counted as the customer opening it, and inert.
  const preview = (await searchParams).preview === "1";
  const beacon = preview ? <PreviewGuard /> : <ViewBeacon token={token} />;
  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  // Fetched before the expired/responded branches below use them.
  const [storedOptions, storedPackages] = await Promise.all([
    listQuoteOptionsAdmin(quote.id),
    listQuotePackagesAdmin(quote.id),
  ]);
  const options = storedOptions.map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description,
    amount: Number(o.amount),
    required: o.required,
    customer_response: o.customer_response,
  }));
  // Packages offered as a choice; empty on ordinary quotes.
  const packages = storedPackages.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    amount: Number(p.amount),
    recommended: p.recommended,
    customer_response: p.customer_response,
  }));
  const itemised = options.length > 0;
  const offersChoice = packages.length > 0;
  // The package they chose, which the confirmation leads with.
  const chosenPackage = packages.find((p) => p.customer_response === "accepted") ?? null;

  const hasPrice = quote.quote_amount != null;
  const amount = hasPrice ? dollars(quote.quote_amount) : null;
  // A declined quote moved off Lost is back on offer, so show the quote.
  const responded = isOpenAgain(quote) ? null : quote.customer_response;
  const firstName = firstNameOf(quote.name, quote.name);

  // Only filled-in sections: sending requires all, but an early-viewed draft
  // can have gaps.
  const sections = QUOTE_SECTION_FIELDS.map((f) => [f, quote[f]] as const).filter(
    (pair): pair is readonly [(typeof QUOTE_SECTION_FIELDS)[number], string] =>
      Boolean(pair[1] && pair[1].trim()),
  );

  // ── The offer ran out ──
  // Instead of the price, never beside it (that invites argument). Re-sending
  // from the CRM gives this same link a fresh QUOTE_TTL_DAYS.
  if (isQuoteExpired(quote)) {
    return (
      <main className="cq-wrap">
        {preview && <PreviewGuard />}
        <div className="cq-confirm">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <h1 className="cq-confirm-title">Hi {firstName}, this quote has expired.</h1>
          <p className="cq-confirm-note">
            Quotes are good for {QUOTE_TTL_DAYS} days so our pricing stays accurate. Give us a call or send a text and
            we&apos;ll send you an updated one.
          </p>
          <ContactButtons />
        </div>
      </main>
    );
  }

  // Whether this job's crew can take cards: used to offer the deposit and show
  // the balance. A button that fails on tap is worse than none.
  const payee = await payeeState(quote);

  // ── Full-screen confirmation once the customer has responded ──
  if (responded === "accepted") {
    // Approving doesn't book a day; until the crew confirm one, don't claim a date.
    const awaitingDate = !quote.scheduled_date;
    // Index-aligned: preferred_times[i] is the start for preferred_dates[i]; may be null.
    const preferredTimes = quote.preferred_times ?? [];
    const preferred = (quote.preferred_dates ?? [])
      .filter(Boolean)
      .map((d, i) => `${prettyDate(d)}${preferredTimes[i] ? ` at ${preferredTimes[i]}` : ""}`);
    // What's still owed, so this stays the page to pay from after approval
    // (it's the link the office texts when a balance is due).
    const { ledger } = await jobLedger(quote);
    // An unanswered change goes ABOVE the confirmation: the rest is a receipt,
    // and a question buried under a receipt goes unanswered. Totals come from
    // the row and the ledger.
    const pendingChange =
      quote.change_requested_at && quote.change_amount != null
        ? {
            requestedAt: quote.change_requested_at,
            note: quote.change_note ?? "",
            fromCents: toCents(quote.quote_amount),
            toCents: toCents(quote.change_amount),
            paidCents: ledger.paidCents,
            lines: quote.change_lines,
            depositCents: quote.change_deposit_cents,
          }
        : null;
    // Unpaid second deposit from an approved change; clears once recorded (depositDueNowCents).
    const dueNowCents = depositDueNowCents(quote.deposit_target_cents, ledger.paidCents, ledger.dueCents);
    const bookedFor = quote.scheduled_date
      ? `${prettyDate(quote.scheduled_date)}${quote.scheduled_time ? ` at ${quote.scheduled_time}` : ""}`
      : null;
    return (
      <main className="cq-wrap">
        {beacon}
        {pendingChange && (
          <ChangeReview
            token={token}
            requestedAt={pendingChange.requestedAt}
            note={pendingChange.note}
            fromCents={pendingChange.fromCents}
            toCents={pendingChange.toCents}
            paidCents={pendingChange.paidCents}
            when={bookedFor}
            lines={pendingChange.lines}
            depositCents={pendingChange.depositCents}
            payHref={payee.ok ? `/pay/${token}` : null}
          />
        )}
        {/* While a change waits, this is the job as it stands, not a "you're all
            set" (they aren't: there's a question above). */}
        <div className={pendingChange ? "cq-confirm" : "cq-confirm cq-confirm-ok"}>
          {pendingChange ? (
            <h2 className="cq-confirm-title cq-confirm-title-sub">What you&apos;ve approved so far</h2>
          ) : (
            <>
              <div className="cq-confirm-badge">
                <CheckMark />
              </div>
              <h1 className="cq-confirm-title">
                Thanks{firstName ? `, ${firstName}` : ""}. {awaitingDate ? "Quote approved." : "You're booked."}
              </h1>
            </>
          )}
          {awaitingDate ? (
            <p className="cq-confirm-date">
              We&apos;re checking the crew&apos;s schedule and will text you to confirm your installation date.
              {preferred.length > 0 && (
                <>
                  {" "}
                  You told us these work: <strong>{preferred.join(", ")}</strong>.
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
          {/* Item by item: this is their record, and "approved" alone doesn't say which. */}
          {(itemised || chosenPackage) && (
            <ul className="cq-confirm-items">
              {chosenPackage && (
                <li className="cq-confirm-item-pick">
                  <span>{chosenPackage.title}</span>
                  <strong>{dollars(chosenPackage.amount)}</strong>
                </li>
              )}
              {options
                .filter((o) => o.customer_response !== "declined")
                .map((o) => (
                  <li key={o.id}>
                    <span>{o.title}</span>
                    <strong>{dollars(o.amount)}</strong>
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

          {/* Only once something's been paid: right after approving they don't
              need an invoice-shaped thing until they choose to pay. */}
          {ledger.paidCents > 0 && (
            <p className="cq-confirm-paid">
              {dueNowCents > 0 ? (
                <>
                  Paid <strong>{usd(ledger.paidCents)}</strong> · <strong>{usd(dueNowCents)}</strong> deposit due now ·{" "}
                  {usd(ledger.dueCents - dueNowCents)} when the work is done
                </>
              ) : ledger.dueCents > 0 ? (
                <>
                  Paid <strong>{usd(ledger.paidCents)}</strong> · <strong>{usd(ledger.dueCents)}</strong> to go
                </>
              ) : (
                <>
                  Paid in full · <strong>{usd(ledger.paidCents)}</strong>
                </>
              )}
            </p>
          )}
          {/* Not while a change waits: the balance is about to move, and the
              change card offers its own payment once approved. */}
          {payee.ok && ledger.dueCents > 0 && !pendingChange && (
            <Link href={`/pay/${token}`} className="cq-btn cq-btn-primary cq-confirm-pay">
              {dueNowCents > 0
                ? `Pay the ${usd(dueNowCents)} deposit`
                : ledger.paidCents > 0
                  ? `Pay the ${usd(ledger.dueCents)} balance`
                  : "Pay your deposit"}
            </Link>
          )}

          <p className="cq-confirm-note">
            {pendingChange
              ? "Nothing here changes unless you approve the change above. Questions, just call or text."
              : awaitingDate
                ? "If none of those days work out, we'll call you to find one that does."
                : "We'll text a reminder before we arrive."}
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
        {beacon}
        <div className="cq-confirm">
          <h1 className="cq-confirm-title">Quote declined</h1>
          <p className="cq-confirm-note">
            Thanks for letting us know{firstName ? `, ${firstName}` : ""}. If anything changes, we&apos;re a call or
            text away.
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
  // With line items or a choice, the decision is the page.
  const built = hasPrice && (itemised || offersChoice);
  // Fixed section order so every quote answers the same questions in the same
  // places. Legacy quotes fall back to their free-text summary.
  const hasDetails = sections.length > 0 || Boolean(quote.quote_summary);
  const details = (
    <>
    {sections.length > 0 ? (
      <div className="cq-summary">
        <h2>What&apos;s included</h2>
        <QuoteSections sections={sections.map(([field, value]) => [QUOTE_SECTION_LABELS[field], value] as const)} />
      </div>
    ) : (
      quote.quote_summary && (
        <div className="cq-summary">
          <h2>What&apos;s included</h2>
          <p>{quote.quote_summary}</p>
        </div>
      )
    )}
    </>
  );
  return (
    <main className="cq-wrap">
      {beacon}
      <div className="cq-card">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
        </header>

        <h1 className="cq-title">Hi {firstName},</h1>

        {hasPrice ? (
          <>
            <p className="cq-lead">
              {offersChoice
                ? "Here's your quote, priced both ways. Pick the one you'd like below and your total is worked out for you."
                : itemised && options.every((o) => o.required)
                  ? // A straight breakdown: nothing to choose, so don't ask.
                    `Here's your quote${quote.service ? ` for ${quote.service.toLowerCase()}` : ""}, broken down line by line.`
                  : itemised
                  ? "Here's your quote. Some of it is up to you - say yes or no to each option below and your total updates as you go."
                  : `Here's your quote${quote.service ? ` for ${quote.service.toLowerCase()}` : ""}. We'd love to do the work for you.`}
            </p>
            {/* Itemised/choice quotes print no single price here: it moves with
                their answers below. One price on the page, never two. */}
            {!itemised && !offersChoice && (
              <div className="cq-price">
                <span className="cq-price-label">Your price</span>
                <span className="cq-price-value">{amount}</span>
                {/* Under the price, which the deadline is about. Only once sent. */}
                {quote.quote_expires_at && (
                  <span className="cq-expiry">Good through {prettyDate(quote.quote_expires_at.slice(0, 10))}</span>
                )}
              </div>
            )}
            {(itemised || offersChoice) && quote.quote_expires_at && (
              <p className="cq-expiry cq-expiry-line">
                Good through {prettyDate(quote.quote_expires_at.slice(0, 10))}
              </p>
            )}
          </>
        ) : (
          <p className="cq-lead">
            Thanks for reaching out. We&apos;re putting your quote together and will have your price here shortly.
          </p>
        )}

        {/* Options quotes lead with the decision; details fold away below since
            they're the same whichever is picked. One-price quotes keep details on top. */}
        {!built && details}
        {hasPrice ? (
          <QuoteActions
            token={token}
            amount={Number(quote.quote_amount)}
            // The assigned crew's real hours, so nobody is offered a 7am start by a 9am crew.
            slots={slotsFor(await getWorkHours(quote.assigned_to))}
            cardReady={payee.ok}
            payMethods={await jobPayMethods(quote.assigned_to)}
            options={options.map((o) => ({
              id: o.id,
              title: o.title,
              description: o.description,
              amount: o.amount,
              required: o.required,
            }))}
            packages={packages.map((p) => ({
              id: p.id,
              title: p.title,
              description: p.description,
              amount: p.amount,
              recommended: p.recommended,
            }))}
          />
        ) : null}

        {built && hasDetails && (
          <details className="cq-details">
            <summary>
              <span>Show job details</span>
            </summary>
            {details}
          </details>
        )}

        {/* Below the decision: checked after liking the number, and every line
            above Approve is more scrolling. */}
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

        {/* One real testimonial, just below the decision point. */}
        {hasPrice && (
          <blockquote className="cq-review">
            <p>&ldquo;{testimonials[0].quote}&rdquo;</p>
            <footer>
              {testimonials[0].name}, {testimonials[0].city}
            </footer>
          </blockquote>
        )}

        <ContactButtons />
        {hasPrice && (
          <p className="cq-fine">
            <a href={`/q/${token}/pdf`}>Download a PDF copy</a>
          </p>
        )}
      </div>
    </main>
  );
}
