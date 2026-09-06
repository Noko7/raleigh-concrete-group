import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { DEFAULT_DEPOSIT_PERCENT, METHOD_LABELS, depositCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { jobLedger, payeeState, reconcileCheckout } from "@/lib/crm/payments";
import { getQuoteByToken } from "@/lib/crm/queries";
import { businessName, links, phoneDisplay } from "@/lib/site-data";
import { PayPanel } from "./pay-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Pay for Your Project | Raleigh Concrete Group" },
  robots: { index: false, follow: false },
};

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

function payDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The customer's payment page.
 *
 * Behind the same unguessable token as their quote, and deliberately the same
 * link for the whole life of the job: a deposit today, a balance in three
 * weeks, and a card payment finishing what a cash payment started all happen
 * here. One link the office can text again at any point beats a new link per
 * payment, which is how a customer ends up paying an old one twice.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; back?: string }>;
}) {
  const { token } = await params;
  const { done, back } = await searchParams;

  const quote = await getQuoteByToken("public_token", token);
  if (!quote) notFound();

  // Straight back from Stripe. The webhook is the real path, but the customer
  // gets here within a second of paying and the two race - so ask Stripe
  // ourselves rather than showing a paid job as unpaid. Also the safety net if
  // the webhook is ever misconfigured: payments still land, just a beat later.
  const justPaid = done ? await reconcileCheckout(done) : null;

  const firstName = quote.name.trim().split(/\s+/)[0] || quote.name;
  const accepted = quote.customer_response === "accepted" && quote.status !== "lost";
  const hasPrice = quote.quote_amount != null && Number(quote.quote_amount) > 0;

  // ── Nothing to pay ──
  // A quote that was never approved, was declined, or has no price on it yet.
  // Said plainly rather than shown as a $0 balance, which reads like a bug.
  if (!accepted || !hasPrice) {
    return (
      <main className="cq-wrap">
        <div className="cq-confirm">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-confirm-eyebrow cq-confirm-eyebrow-muted">Nothing due</p>
          <h1 className="cq-confirm-title">Hi {firstName}, there&apos;s nothing to pay here yet.</h1>
          <p className="cq-confirm-note">
            {quote.customer_response === "declined"
              ? "This quote was declined, so nothing is owed. If that was a mistake, give us a call and we'll pick it back up."
              : "Once your quote is approved, this is where you'll be able to pay. Give us a call if you think that's wrong."}
          </p>
          <ContactButtons />
        </div>
      </main>
    );
  }

  const { ledger, rows } = await jobLedger(quote);
  const payee = await payeeState(quote);
  const paidRows = rows.filter((r) => r.status === "paid" || r.status === "refunded");
  const settled = ledger.dueCents <= 0;
  const deposit = Math.min(depositCents(ledger.totalCents, DEFAULT_DEPOSIT_PERCENT), ledger.dueCents);
  const progress = ledger.totalCents > 0 ? Math.min(100, Math.round((ledger.paidCents / ledger.totalCents) * 100)) : 0;
  const payeeName = payee.ok ? payee.staff.full_name?.trim() || businessName : businessName;

  return (
    <main className="cq-wrap">
      <div className="cq-card pay-card">
        <header className="cq-head">
          <Image src="/images/logo_horizontal.png" alt={businessName} width={967} height={243} className="cq-logo" priority />
          <p className="cq-eyebrow">{settled ? "Paid in full" : "Your payment"}</p>
        </header>

        {/* The receipt, first, and only when they have just paid. Somebody
            landing back from Stripe wants confirmation before anything else,
            and a page that just quietly shows a smaller balance leaves them
            wondering whether it went through. */}
        {justPaid?.status === "paid" && (
          <div className="pay-receipt">
            <p className="pay-receipt-eyebrow">Payment received</p>
            <strong>{usd(justPaid.amount_cents)}</strong>
            <p>Thanks {firstName} - your card went through. A receipt is on its way to you from Stripe.</p>
          </div>
        )}
        {done && justPaid?.status === "pending" && (
          <div className="pay-note">
            Your bank is still confirming this one. It usually takes a moment - refresh this page shortly and it&apos;ll
            show up below.
          </div>
        )}
        {back && !settled && <div className="pay-note">No payment was taken. Nothing has changed on your job.</div>}

        <h1 className="cq-title">{settled ? `Thanks, ${firstName}.` : `Hi ${firstName},`}</h1>

        <div className={`pay-due${settled ? " pay-due-clear" : ""}`}>
          <span className="pay-due-label">{settled ? "Balance" : "Balance due"}</span>
          <span className="pay-due-value">{usd(ledger.dueCents)}</span>
          <div className="pay-bar" role="img" aria-label={`${progress}% of this job is paid`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <dl className="pay-split">
            <div>
              <dt>Job total</dt>
              <dd>{usd(ledger.totalCents)}</dd>
            </div>
            <div>
              <dt>Paid so far</dt>
              <dd>{usd(ledger.paidCents)}</dd>
            </div>
          </dl>
        </div>

        {/* Every payment on the job, however it was made. The cash the crew
            took on site belongs here as much as the card ones - this is the
            customer's record of what they have handed over, and a list that
            only showed card payments would understate it. */}
        {paidRows.length > 0 && (
          <ul className="pay-history">
            {paidRows.map((r) => (
              <li key={r.id}>
                <span className="pay-history-when">{payDate(r.paid_at ?? r.created_at)}</span>
                <span className="pay-history-how">{METHOD_LABELS[r.method as PaymentMethod] ?? r.method}</span>
                <span className="pay-history-amount">
                  {usd(r.amount_cents - r.refunded_cents)}
                  {r.refunded_cents > 0 && <em> ({usd(r.refunded_cents)} refunded)</em>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {settled ? (
          <p className="cq-lead pay-done">
            Your project is paid in full. Thank you for supporting a local crew - if you were happy with the work, a
            review means the world to us.
          </p>
        ) : payee.ok ? (
          <PayPanel
            token={token}
            dueCents={ledger.dueCents}
            depositCents={deposit}
            paidCents={ledger.paidCents}
            payeeName={payeeName}
          />
        ) : (
          // Card is not an option on this job. Never say why - "the contractor
          // hasn't finished Stripe onboarding" is our problem, not something a
          // customer standing with a phone can act on. Give them the way that
          // does work instead.
          <div className="pay-offline">
            <h2>Pay your crew directly</h2>
            <p>
              Card payment isn&apos;t set up on this job. Your crew can take cash, check, Zelle or Venmo on site - or
              give us a call and we&apos;ll sort it out with you.
            </p>
          </div>
        )}

        <ContactButtons />
        <p className="cq-fine">
          Questions about your balance? Call or text and we&apos;ll walk you through it. Nothing is ever charged
          automatically.
        </p>
      </div>
    </main>
  );
}
