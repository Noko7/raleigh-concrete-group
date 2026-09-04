"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ymdInDays } from "@/lib/crm/clock";
import { DECLINE_CREDIT, LEAD_TIME_DAYS, MAX_PREFERRED_DATES, selectedTotal } from "@/lib/crm/constants";

type Mode = "choose" | "save" | "schedule" | "submitting" | "accepted" | "declined";

// One line item as the customer sees it. `required` items are part of the job
// and shown so they can see what they are paying for; the rest are theirs to
// take or leave.
export type PublicOption = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  required: boolean;
};

function pretty(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function QuoteActions({
  token,
  amount,
  options = [],
}: {
  token: string;
  amount: number | null;
  options?: PublicOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [discount, setDiscount] = useState(false);
  // Days the customer says work for them. The crew confirms one of these against
  // their own schedule, so nothing here is a booking.
  const [picks, setPicks] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState<string[]>([]);
  // Their yes/no per optional line item. Nothing is pre-answered: an untouched
  // box is a customer who scrolled past it, not a decision, and either reading
  // of it would be us deciding for them.
  const [answers, setAnswers] = useState<Record<string, "accepted" | "declined">>({});

  const itemised = options.length > 0;
  const optional = options.filter((o) => !o.required);
  const answered = optional.filter((o) => answers[o.id]).length;
  const allAnswered = answered === optional.length;
  // What they are buying right now. Required items always count; optional ones
  // only once they have said yes.
  const running = useMemo(() => selectedTotal(options, answers), [options, answers]);
  // The figure every price below is worked from: their selection on an itemised
  // quote, the single price on an ordinary one.
  const total = itemised ? running : (amount ?? 0);
  const canApprove = itemised ? allAnswered && total > 0 : amount != null;

  // Counted in Raleigh days. The customer's phone may be in another zone, and
  // the server checks the same floor the same way.
  const minDate = useMemo(() => ymdInDays(LEAD_TIME_DAYS), []);

  // Warn early if a day is already spoken for, so the customer doesn't offer
  // three days we can't use.
  async function addDate(d: string) {
    setError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (picks.includes(d)) {
      setDraft("");
      return;
    }
    if (picks.length >= MAX_PREFERRED_DATES) {
      setError(`You can suggest up to ${MAX_PREFERRED_DATES} days.`);
      return;
    }
    setPicks((p) => [...p, d].sort());
    setDraft("");

    setChecking(true);
    try {
      const res = await fetch(`/api/availability?type=job&date=${d}`);
      const json = (await res.json()) as { available?: boolean };
      if (json.available === false) setTaken((t) => (t.includes(d) ? t : [...t, d]));
    } catch {
      // A failed check is not worth blocking on - the crew confirms anyway.
    } finally {
      setChecking(false);
    }
  }

  function removeDate(d: string) {
    setPicks((p) => p.filter((x) => x !== d));
    setTaken((t) => t.filter((x) => x !== d));
  }

  // What the save offer is quoted against. On an itemised quote somebody can
  // reach it having answered nothing, and striking through $0 is not an offer -
  // so it falls back to the all-in figure until they have picked something.
  const offerBase = itemised && running === 0 ? (amount ?? 0) : total;
  const discounted = Math.max(0, Math.round((offerBase - DECLINE_CREDIT) * 100) / 100);

  async function submit(action: "accept" | "decline") {
    setError("");
    const fallback: Mode = action === "accept" ? "schedule" : "save";
    setMode("submitting");
    try {
      const res = await fetch("/api/quote-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action,
          discount,
          preferred_dates: action === "accept" ? picks : undefined,
          // Every item, including the required ones, so the server records a
          // decision against each rather than inferring one.
          options: action === "accept" && itemised ? answersWithRequired(options, answers) : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMode(action === "accept" ? "accepted" : "declined");
        // Re-render the server page into its full-screen confirmed/declined view.
        router.refresh();
      } else {
        setError(json.error || "Something went wrong. Please call us.");
        setMode(fallback);
      }
    } catch {
      setError("Something went wrong. Please call us.");
      setMode(fallback);
    }
  }

  if (mode === "accepted") {
    const finalPrice = discount ? discounted : total;
    const bought = options.filter((o) => o.required || answers[o.id] === "accepted");
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">Quote approved</p>
        <h3>Thanks! We&apos;ll confirm your date shortly</h3>
        {bought.length > 0 && (
          <p className="cq-result-note">You approved: {bought.map((o) => o.title).join(", ")}.</p>
        )}
        <p className="cq-result-price">
          {discount && <span className="cq-result-save">${DECLINE_CREDIT} credit applied</span>}
          <strong>{usd(finalPrice)}</strong>
        </p>
        {picks.length > 0 && (
          <p className="cq-result-note">
            You told us these work: {picks.map((d) => pretty(d)).join(", ")}.
          </p>
        )}
        <p className="cq-result-note">
          We&apos;re checking the crew&apos;s schedule now and will text you to confirm your installation date.
        </p>
      </div>
    );
  }

  if (mode === "declined") {
    return (
      <div className="cq-result">
        <p className="cq-result-eyebrow">Quote declined</p>
        <h3>Thanks for letting us know</h3>
        <p className="cq-result-note">No hard feelings. If anything changes, we&apos;re just a call or text away.</p>
      </div>
    );
  }

  if (mode === "save") {
    return (
      <div className="cq-offer">
        <p className="cq-offer-eyebrow">Wait, before you go</p>
        <h3>Here&apos;s a ${DECLINE_CREDIT} credit to earn your business.</h3>
        <p className="cq-offer-price">
          <s>{usd(offerBase)}</s> <strong>{usd(discounted)}</strong>
        </p>
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          onClick={() => {
            setDiscount(true);
            // Taking the credit is not the same as having chosen. On an
            // itemised quote with questions still open, this goes back to them
            // rather than to the calendar - otherwise they land on the date
            // picker and the server refuses the approval they thought they gave.
            setMode(itemised && !allAnswered ? "choose" : "schedule");
          }}
        >
          Take ${DECLINE_CREDIT} off &amp; approve
        </button>
        <button type="button" className="cq-textlink" onClick={() => submit("decline")}>
          No thanks, decline
        </button>
      </div>
    );
  }

  if (mode === "schedule" || mode === "submitting") {
    const busy = mode === "submitting";
    return (
      <div className="cq-schedule">
        <h3>Which days work for you?</h3>
        <p className="cq-fine">
          Pick up to {MAX_PREFERRED_DATES} days that suit you, starting {LEAD_TIME_DAYS} days from now. Our crew will
          confirm one of them and text you back. Nothing is booked until then.
        </p>
        {/* What they are approving, carried into this step: the decision they
            just made is two taps behind them and worth restating before they
            commit to it. */}
        {itemised && (
          <p className="cq-fine cq-sched-scope">
            Approving: {options.filter((o) => o.required || answers[o.id] === "accepted").map((o) => o.title).join(", ")}{" "}
            &middot; <strong>{usd(discount ? discounted : total)}</strong>
          </p>
        )}
        {discount && !itemised && (
          <p className="cq-offer-price">
            With ${DECLINE_CREDIT} credit: <strong>{usd(discounted)}</strong>
          </p>
        )}

        {picks.length > 0 && (
          <ul className="cq-picks">
            {picks.map((d) => (
              <li key={d} className={taken.includes(d) ? "cq-pick cq-pick-taken" : "cq-pick"}>
                <span>
                  {pretty(d)}
                  {taken.includes(d) && <em> (likely full, we&apos;ll suggest another)</em>}
                </span>
                <button type="button" onClick={() => removeDate(d)} disabled={busy} aria-label={`Remove ${pretty(d)}`}>
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        {picks.length < MAX_PREFERRED_DATES && (
          <input
            type="date"
            className="cq-date"
            min={minDate}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              addDate(e.target.value);
            }}
            disabled={busy}
          />
        )}
        {checking && <p className="cq-fine">Checking that day&hellip;</p>}
        {error && <p className="cq-err">{error}</p>}

        <button
          type="button"
          className="cq-btn cq-btn-accept"
          disabled={picks.length === 0 || busy}
          onClick={() => submit("accept")}
        >
          {busy ? "Sending…" : "Approve quote"}
        </button>
        <button type="button" className="cq-textlink" disabled={busy} onClick={() => setMode("choose")}>
          Back
        </button>
      </div>
    );
  }

  // choose
  return (
    <>
      {/* The whole point of an itemised quote: each extra is its own yes or no,
          and the total underneath moves as they answer. Nothing is ticked for
          them, so the number they end up approving is one they built. */}
      {itemised && (
        <div className="cq-opts">
          <h2 className="cq-opts-title">Choose what you&apos;d like</h2>
          {discount && (
            <p className="cq-fine cq-opt-todo">
              Your ${DECLINE_CREDIT} credit is held. Answer each option and it comes off the total below.
            </p>
          )}
          <ul className="cq-opt-list">
            {options.map((o) => {
              const answer = answers[o.id];
              const on = o.required || answer === "accepted";
              return (
                <li key={o.id} className={`cq-opt${on ? " cq-opt-on" : ""}${answer === "declined" ? " cq-opt-off" : ""}`}>
                  <div className="cq-opt-head">
                    <span className="cq-opt-title">{o.title}</span>
                    <span className="cq-opt-price">{usd(o.amount)}</span>
                  </div>
                  {o.description && <p className="cq-opt-desc">{o.description}</p>}
                  {o.required ? (
                    <span className="cq-opt-included">Included in your project</span>
                  ) : (
                    <div className="cq-opt-choice" role="group" aria-label={`${o.title}: add it or not`}>
                      <button
                        type="button"
                        className={`cq-opt-btn${answer === "accepted" ? " cq-opt-btn-yes" : ""}`}
                        aria-pressed={answer === "accepted"}
                        onClick={() => setAnswers((a) => ({ ...a, [o.id]: "accepted" }))}
                      >
                        Yes, add it
                      </button>
                      <button
                        type="button"
                        className={`cq-opt-btn${answer === "declined" ? " cq-opt-btn-no" : ""}`}
                        aria-pressed={answer === "declined"}
                        onClick={() => setAnswers((a) => ({ ...a, [o.id]: "declined" }))}
                      >
                        No thanks
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="cq-opt-total">
            <span>Your total</span>
            <strong>{usd(discount && running > 0 ? Math.max(0, running - DECLINE_CREDIT) : running)}</strong>
          </div>
          {!allAnswered && (
            <p className="cq-fine cq-opt-todo">
              {optional.length - answered === 1
                ? "One option still needs a yes or no."
                : `${optional.length - answered} options still need a yes or no.`}
            </p>
          )}
          {allAnswered && total === 0 && (
            <p className="cq-fine cq-opt-todo">
              You&apos;ve said no to everything. Use Decline below if none of it is for you.
            </p>
          )}
        </div>
      )}

      <div className="cq-actions">
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          disabled={!canApprove}
          onClick={() => {
            setDiscount(false);
            setMode("schedule");
          }}
        >
          Approve quote
        </button>
        <button type="button" className="cq-btn cq-btn-decline" onClick={() => setMode("save")}>
          Decline
        </button>
      </div>
    </>
  );
}

// Required items are sent as accepted rather than left out. The server would
// treat them that way regardless, but a record that says every item was
// answered is the one worth having when somebody asks what they agreed to.
function answersWithRequired(
  options: PublicOption[],
  answers: Record<string, "accepted" | "declined">,
): Record<string, "accepted" | "declined"> {
  const out: Record<string, "accepted" | "declined"> = { ...answers };
  for (const o of options) if (o.required) out[o.id] = "accepted";
  return out;
}
