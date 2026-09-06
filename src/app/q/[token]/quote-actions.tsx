"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ymdInDays } from "@/lib/crm/clock";
import {
  DECLINE_CREDIT,
  DEFAULT_VISIT_SLOTS,
  LEAD_TIME_DAYS,
  MAX_PREFERRED_DATES,
  selectedTotal,
} from "@/lib/crm/constants";
import { DEFAULT_DEPOSIT_PERCENT, depositCents, usd as money } from "@/lib/crm/fees";

// One day the customer says works, and the time they'd like the crew to start.
// Nothing here is a booking - the crew confirms one of these against their own
// schedule - but a day with no time on it puts the crew back on the phone to
// ask, which is the call this step exists to remove.
//
// Not called `Pick`: that is a TypeScript built-in, and shadowing it in a file
// is a trap for whoever next needs `Pick<Quote, "id">` in here.
type DayPick = { date: string; time: string };

type Mode = "choose" | "save" | "schedule" | "submitting" | "accepted" | "paying" | "declined";

// How the customer said they want to pay, chosen at the moment they approve -
// the point they are most decided, and the only point where asking costs
// nothing. It is a statement of intent, not a commitment: "card" sends them
// straight to checkout, "direct" leaves the balance for the crew to take on
// site, and either way the payment page stays open to them afterwards.
type PayChoice = "card" | "direct";

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
const DEPOSIT_LABEL = `${DEFAULT_DEPOSIT_PERCENT}%`;

export function QuoteActions({
  token,
  amount,
  options = [],
  // The start times the assigned crew offers, from their own working hours.
  // Falls back to the default window on a quote with nobody assigned yet.
  slots = DEFAULT_VISIT_SLOTS,
  // Whether the crew on this job can actually take a card. False means the
  // deposit button is never offered - a payment button that dies on tap is
  // worse than never having shown one.
  cardReady = false,
}: {
  token: string;
  amount: number | null;
  options?: PublicOption[];
  slots?: string[];
  cardReady?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [discount, setDiscount] = useState(false);
  // Days the customer says work for them, each with a start time. The crew
  // confirms one of these against their own schedule, so nothing here is a
  // booking.
  const [picks, setPicks] = useState<DayPick[]>([]);
  const [draft, setDraft] = useState("");
  // The time a newly added day gets. One control above the list rather than one
  // per row: almost nobody wants a different hour on each of three days, and
  // any row can still be changed on its own afterwards.
  const [time, setTime] = useState(slots[1] ?? slots[0] ?? "9:00 AM");
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
    if (picks.some((p) => p.date === d)) {
      setDraft("");
      return;
    }
    if (picks.length >= MAX_PREFERRED_DATES) {
      setError(`You can suggest up to ${MAX_PREFERRED_DATES} days.`);
      return;
    }
    setPicks((p) => [...p, { date: d, time }].sort((a, b) => a.date.localeCompare(b.date)));
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
    setPicks((p) => p.filter((x) => x.date !== d));
    setTaken((t) => t.filter((x) => x !== d));
  }

  function setPickTime(d: string, t: string) {
    setPicks((p) => p.map((x) => (x.date === d ? { ...x, time: t } : x)));
  }

  // What the save offer is quoted against. On an itemised quote somebody can
  // reach it having answered nothing, and striking through $0 is not an offer -
  // so it falls back to the all-in figure until they have picked something.
  const offerBase = itemised && running === 0 ? (amount ?? 0) : total;
  const discounted = Math.max(0, Math.round((offerBase - DECLINE_CREDIT) * 100) / 100);

  async function submit(action: "accept" | "decline", pay?: PayChoice) {
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
          // Recorded on the job so the crew knows what to expect before they
          // turn up. It changes nothing about what is owed.
          pay: action === "accept" ? pay : undefined,
          // Two arrays rather than a list of pairs, because that is the shape
          // the two columns already have and the crew's card reads them by
          // index.
          preferred_dates: action === "accept" ? picks.map((p) => p.date) : undefined,
          preferred_times: action === "accept" ? picks.map((p) => p.time) : undefined,
          // Every item, including the required ones, so the server records a
          // decision against each rather than inferring one.
          options: action === "accept" && itemised ? answersWithRequired(options, answers) : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        // Straight to checkout when they asked to pay now. The approval is
        // already recorded, so a customer who changes their mind on the Stripe
        // page still has an approved job and a link back to it - the two
        // decisions are separate and only one of them is reversible.
        if (action === "accept" && pay === "card") {
          setMode("paying");
          router.push(`/pay/${token}`);
          return;
        }
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

  // Approved, and on their way to Stripe. Its own state rather than the
  // confirmation panel: showing "we'll confirm your date shortly" and then
  // yanking the page out from under them reads as a glitch.
  if (mode === "paying") {
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">Quote approved</p>
        <h3>Opening your secure checkout&hellip;</h3>
        <p className="cq-result-note">One moment. If nothing happens, tap the payment link we just texted you.</p>
      </div>
    );
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
            You told us these work: {picks.map((p) => `${pretty(p.date)} at ${p.time}`).join(", ")}.
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
          Pick up to {MAX_PREFERRED_DATES} days that suit you, starting {LEAD_TIME_DAYS} days from now, and the time
          you&apos;d like us to start. Our crew will confirm one of them and text you back. Nothing is booked until
          then.
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
            {picks.map((p) => (
              <li key={p.date} className={taken.includes(p.date) ? "cq-pick cq-pick-taken" : "cq-pick"}>
                <span>
                  {pretty(p.date)}
                  {taken.includes(p.date) && <em> (likely full, we&apos;ll suggest another)</em>}
                </span>
                {/* Per row, so somebody who wants an early start on the Monday
                    and a later one on the Friday can say so. Seeded from the
                    control below rather than left blank. */}
                <select
                  className="cq-pick-time"
                  value={p.time}
                  disabled={busy}
                  aria-label={`Start time on ${pretty(p.date)}`}
                  onChange={(e) => setPickTime(p.date, e.target.value)}
                >
                  {slots.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeDate(p.date)}
                  disabled={busy}
                  aria-label={`Remove ${pretty(p.date)}`}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        {picks.length < MAX_PREFERRED_DATES && (
          <div className="cq-pick-add">
            <label className="cq-pick-field">
              <span>Day</span>
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
            </label>
            <label className="cq-pick-field">
              <span>Start time</span>
              <select
                className="cq-date"
                value={time}
                disabled={busy}
                onChange={(e) => setTime(e.target.value)}
              >
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {checking && <p className="cq-fine">Checking that day&hellip;</p>}
        {error && <p className="cq-err">{error}</p>}

        {/* The payment question is asked here and nowhere else: this is the
            one moment the customer has decided and hasn't yet moved on. Asked
            a day later by text it becomes a chase; asked before they have
            chosen their days it is a toll booth in front of the decision.

            Both answers approve the quote. Only the route afterwards differs,
            which is why neither is styled as a refusal - a customer who wants
            to hand the crew cash has not done anything wrong. */}
        {cardReady ? (
          <div className="cq-pay">
            <p className="cq-pay-lead">
              A {DEPOSIT_LABEL} deposit books your date and covers materials. The rest is due when the work is finished.
            </p>
            <button
              type="button"
              className="cq-btn cq-btn-accept"
              disabled={picks.length === 0 || busy}
              onClick={() => submit("accept", "card")}
            >
              {busy ? "Sending…" : `Approve & pay ${money(depositCents(Math.round((discount ? discounted : total) * 100)))} deposit`}
            </button>
            <button
              type="button"
              className="cq-btn cq-pay-alt"
              disabled={picks.length === 0 || busy}
              onClick={() => submit("accept", "direct")}
            >
              Approve now, pay the crew directly
            </button>
            <p className="cq-fine cq-pay-fine">
              Cash, check, Zelle or Venmo on site - whatever suits you. You can still pay by card later from the link
              we text you.
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="cq-btn cq-btn-accept"
            disabled={picks.length === 0 || busy}
            onClick={() => submit("accept", "direct")}
          >
            {busy ? "Sending…" : "Approve quote"}
          </button>
        )}
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
