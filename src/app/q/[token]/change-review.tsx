"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { usd as money } from "@/lib/crm/fees";

// The customer answering a change to an approved (often half-paid) job. A bigger
// number first reads as a bill, so the order is fixed: what's changing, the date
// is safe, the money, then the buttons.
//
// The deposit must be unmissable: "New balance $5,275" alone looks like a second
// invoice on top of the $4,125 paid. Whenever something's been paid, that row
// sits with the totals rather than being summarised away.
type Mode = "choose" | "sending" | "done" | "declined";

export function ChangeReview({
  token,
  requestedAt,
  note,
  fromCents,
  toCents,
  paidCents,
  when,
  lines = null,
  depositCents = null,
  payHref = null,
}: {
  token: string;
  /** Which change this is (its change_requested_at), so an answer can't land on another. */
  requestedAt: string;
  /** What the crew said is changing, word for word. */
  note: string;
  /** The total they agreed to. */
  fromCents: number;
  /** What the job would come to. */
  toCents: number;
  /** Already paid (the deposit). */
  paidCents: number;
  /** Their booked day, already formatted, when they have one. */
  when: string | null;
  /** The change's breakdown, if any; it sums to the new total, so it sits above it. */
  lines?: { title: string; description: string | null; amount: number }[] | null;
  /**
   * Second deposit the change asks for, in cents, paid on approval for the added
   * work's materials. Null when none.
   */
  depositCents?: number | null;
  /** Where to pay it by card, when card payment is set up for this job. */
  payHref?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);

  const diff = toCents - fromCents;
  const dueCents = Math.max(0, toCents - paidCents);
  // Overpaid for the new total: said plainly, so they know money is coming back.
  const refundCents = Math.max(0, paidCents - toCents);
  // What to send now vs at the end, when a deposit is asked for.
  const nowCents = depositCents && depositCents > 0 ? Math.min(depositCents, dueCents) : 0;
  const restCents = dueCents - nowCents;

  async function answer(action: "accept" | "decline") {
    setError("");
    setMode("sending");
    try {
      const res = await fetch("/api/change-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, requested_at: requestedAt }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string; stale?: boolean };
      if (res.ok && json.ok) {
        setMode(action === "accept" ? "done" : "declined");
        // Re-render into the ordinary confirmed view with the new totals.
        router.refresh();
      } else {
        setStale(json.stale === true);
        setError(json.error || "Something went wrong. Please call us.");
        setMode("choose");
      }
    } catch {
      setError("Something went wrong. Please call us.");
      setMode("choose");
    }
  }

  if (mode === "done") {
    return (
      <div className="cr cr-ok">
        <h2 className="cr-title">Change approved</h2>
        <p className="cr-note">
          Your job is now {money(toCents)}
          {paidCents > 0 && dueCents > 0 ? `, with ${money(dueCents)} left to pay.` : "."}
          {refundCents > 0 && ` We'll get ${money(refundCents)} back to you.`}
        </p>
        {nowCents > 0 && (
          <p className="cr-note">
            <strong>{money(nowCents)} is due now</strong> for the materials. The rest, {money(restCents)}, is due when
            the work is done.
          </p>
        )}
        {nowCents > 0 && payHref && (
          <Link href={payHref} className="cr-yes cr-pay">
            Pay the {money(nowCents)} deposit
          </Link>
        )}
        {when && <p className="cr-note">Your date is still {when}.</p>}
      </div>
    );
  }

  if (mode === "declined") {
    return (
      <div className="cr">
        <h2 className="cr-title">Change declined</h2>
        <p className="cr-note">
          Your job stays as you approved it, at {money(fromCents)}
          {when ? `, on ${when}` : ""}. We&apos;ll give you a call if we need to talk it through.
        </p>
      </div>
    );
  }

  return (
    <div className="cr">
      <h2 className="cr-title">A change to your job</h2>

      {/* Their words first. The number means nothing without it. */}
      <p className="cr-note-body">{note}</p>

      {/* Before the money: "is my date still ok" is their first question. */}
      {when && <p className="cr-date">Your date doesn&apos;t move: <strong>{when}</strong></p>}

      {/* Line by line, styled like their quote's breakdown. */}
      {lines && lines.length > 0 && (
        <div className="cr-lines">
          <p className="cr-lines-title">New price breakdown</p>
          <ul className="cq-opt-list cq-breakdown">
            {lines.map((l, i) => (
              <li key={i} className="cq-opt cq-opt-on">
                <div className="cq-opt-head">
                  <span className="cq-opt-title">{l.title}</span>
                  <span className="cq-opt-price">{money(Math.round(Number(l.amount) * 100))}</span>
                </div>
                {l.description && <p className="cq-opt-desc">{l.description}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="cr-sums">
        <div>
          <dt>Price you approved</dt>
          <dd>{money(fromCents)}</dd>
        </div>
        <div>
          {/* Same total, new breakdown: said as no change, not a "+$0". */}
          <dt>{diff > 0 ? "This change adds" : diff < 0 ? "This change takes off" : "Change to the price"}</dt>
          <dd className={diff > 0 ? "cr-up" : diff < 0 ? "cr-down" : undefined}>
            {diff === 0 ? "None" : `${diff > 0 ? "+" : "-"}${money(Math.abs(diff))}`}
          </dd>
        </div>
        <div className="cr-sums-total">
          <dt>New total</dt>
          <dd>{money(toCents)}</dd>
        </div>
        {/* The deposit on its own line: what stops a new balance reading as a new bill. */}
        {paidCents > 0 && (
          <div>
            <dt>You&apos;ve already paid</dt>
            <dd className="cr-paid">-{money(paidCents)}</dd>
          </div>
        )}
        <div className="cr-sums-strong">
          <dt>{refundCents > 0 ? "Back to you" : "Left to pay"}</dt>
          <dd>{refundCents > 0 ? money(refundCents) : money(dueCents)}</dd>
        </div>
        {/* Second deposit: what to send now for materials, and what waits for the end. */}
        {nowCents > 0 && (
          <>
            <div className="cr-sums-now">
              <dt>Due now, for materials</dt>
              <dd>{money(nowCents)}</dd>
            </div>
            <div>
              <dt>Rest when the work is done</dt>
              <dd>{money(restCents)}</dd>
            </div>
          </>
        )}
      </dl>

      {stale ? (
        // The screen no longer matches the job; only a reload shows the real one.
        <div className="cr-acts">
          <button type="button" className="cr-yes" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      ) : (
        <div className="cr-acts">
          <button type="button" className="cr-yes" onClick={() => answer("accept")} disabled={mode === "sending"}>
            {mode === "sending" ? "One moment…" : "Approve this change"}
          </button>
          <button type="button" className="cr-no" onClick={() => answer("decline")} disabled={mode === "sending"}>
            No, keep it as it was
          </button>
        </div>
      )}

      {error && <p className="cr-err">{error}</p>}
    </div>
  );
}
