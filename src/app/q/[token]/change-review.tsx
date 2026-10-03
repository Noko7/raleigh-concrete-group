"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { usd as money } from "@/lib/crm/fees";

// The customer answering a change to a job they have already approved.
//
// This is the most delicate panel on the customer's side of the whole app. They
// agreed a price, they have very likely already paid half of it, and a screen
// that opens with a bigger number reads as a bill arriving - so the order is
// chosen deliberately: what is changing, then their date is safe, then the
// money, then the two buttons. By the time a figure appears they have already
// read the reason for it.
//
// The deposit is the part that has to be unmissable. "New balance $5,275" on its
// own looks like a second invoice on top of the $4,125 they have paid; the same
// number under a line that says their $4,125 is counted is the balance it
// actually is. So the three rows are always shown together, never summarised.
type Mode = "choose" | "sending" | "done" | "declined";

export function ChangeReview({
  token,
  note,
  fromCents,
  toCents,
  paidCents,
  when,
  lines = null,
}: {
  token: string;
  /** What the crew said is changing, word for word. */
  note: string;
  /** The total they agreed to. */
  fromCents: number;
  /** What the job would come to. */
  toCents: number;
  /** What they have already handed over. The deposit. */
  paidCents: number;
  /** Their booked day, already formatted, when they have one. */
  when: string | null;
  /**
   * The breakdown that comes with the change, when the crew wrote one. It adds
   * up to the new total, so it sits directly above it.
   */
  lines?: { title: string; description: string | null; amount: number }[] | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState("");

  const diff = toCents - fromCents;
  const dueCents = Math.max(0, toCents - paidCents);
  // We have more of their money than the job is now worth. Said plainly rather
  // than shown as a $0 balance, because a customer owed money needs to know it
  // is coming back, not that they owe nothing.
  const refundCents = Math.max(0, paidCents - toCents);

  async function answer(action: "accept" | "decline") {
    setError("");
    setMode("sending");
    try {
      const res = await fetch("/api/change-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMode(action === "accept" ? "done" : "declined");
        // Re-render the page into its ordinary confirmed view, now carrying the
        // new total and balance.
        router.refresh();
      } else {
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
        <p className="cr-eyebrow">Change approved</p>
        <h2 className="cr-title">Thanks - that&apos;s all updated</h2>
        <p className="cr-note">
          Your job is now {money(toCents)}
          {paidCents > 0 && dueCents > 0 ? `, with ${money(dueCents)} left to pay.` : "."}
          {refundCents > 0 && ` We'll get ${money(refundCents)} back to you.`}
        </p>
        {when && <p className="cr-note">Your date is still {when}.</p>}
      </div>
    );
  }

  if (mode === "declined") {
    return (
      <div className="cr">
        <p className="cr-eyebrow cr-eyebrow-muted">Change declined</p>
        <h2 className="cr-title">No problem - nothing has changed</h2>
        <p className="cr-note">
          Your job stays as you approved it, at {money(fromCents)}
          {when ? `, on ${when}` : ""}. We&apos;ll give you a call if we need to talk it through.
        </p>
      </div>
    );
  }

  return (
    <div className="cr">
      <p className="cr-eyebrow">A change to your job</p>
      <h2 className="cr-title">Can you approve this?</h2>

      {/* Their words first. The number means nothing without it. */}
      <p className="cr-note-body">{note}</p>

      {/* Before the money, because "is my date still ok" is the question a
          customer reads a message like this asking. */}
      {when && <p className="cr-date">Your date doesn&apos;t move: <strong>{when}</strong></p>}

      {/* Where the new total goes, line by line. Plain rows, the same look as
          the breakdown on their quote, so it reads as the same document. */}
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
          {/* Same total, new breakdown: said as no change rather than as a
              "+$0" that reads like a trick. */}
          <dt>{diff > 0 ? "This change adds" : diff < 0 ? "This change takes off" : "Change to the price"}</dt>
          <dd className={diff > 0 ? "cr-up" : diff < 0 ? "cr-down" : undefined}>
            {diff === 0 ? "None" : `${diff > 0 ? "+" : "-"}${money(Math.abs(diff))}`}
          </dd>
        </div>
        <div className="cr-sums-total">
          <dt>New total</dt>
          <dd>{money(toCents)}</dd>
        </div>
        {/* The deposit, always on its own line when there is one. This is the
            row that stops a new balance reading as a new bill. */}
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
      </dl>

      <div className="cr-acts">
        <button type="button" className="cr-yes" onClick={() => answer("accept")} disabled={mode === "sending"}>
          {mode === "sending" ? "One moment…" : "Approve this change"}
        </button>
        <button type="button" className="cr-no" onClick={() => answer("decline")} disabled={mode === "sending"}>
          No, keep it as it was
        </button>
      </div>

      {error && <p className="cr-err">{error}</p>}
      <p className="cr-fine">
        Not sure? Give us a call before you answer - we&apos;d rather talk it through than have you guess.
      </p>
    </div>
  );
}
