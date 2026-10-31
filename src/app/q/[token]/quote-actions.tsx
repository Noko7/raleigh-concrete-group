"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ymdInDays } from "@/lib/crm/clock";
import {
  DECLINE_CREDIT,
  DEFAULT_VISIT_SLOTS,
  ECONSENT_DISCLOSURE_PATH,
  ECONSENT_DISCLOSURE_TITLE,
  ECONSENT_TEXT,
  ECONSENT_VERSION,
  dollarsOrZero as usd,
  LEAD_TIME_DAYS,
  MAX_PREFERRED_DATES,
  packageLetter,
  quoteTotal,
} from "@/lib/crm/constants";
import { SectionText } from "@/components/section-text";
import { METHOD_NAMES, PAYMENT_METHODS, type PayMethod } from "@/lib/crm/pay-methods";
import { DEFAULT_DEPOSIT_PERCENT, depositCents, usd as money } from "@/lib/crm/fees";

// One day that works for the customer, with a start time. Not a booking (the
// crew confirm one), but a day without a time means a phone call to ask.
// Not named `Pick`, which would shadow the TypeScript built-in.
type DayPick = { date: string; time: string };

type Mode = "choose" | "save" | "schedule" | "submitting" | "accepted" | "paying" | "declined";

// How they intend to pay, asked at approval when they're most decided. Not a
// commitment: "card" goes to checkout, "direct" leaves it for the crew on site;
// the payment page stays open either way.
type PayChoice = "card" | "direct";

// A line item as the customer sees it. `required` items are part of the job,
// shown so they see what they pay for; the rest are optional.
export type PublicOption = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  required: boolean;
};

// One complete way of doing the job. Mutually exclusive, unlike line items:
// they pick exactly one, and extras are added to it.
export type PublicPackage = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  // The contractor's "which would you pick"; at most one card.
  recommended: boolean;
};

function pretty(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
const DEPOSIT_LABEL = `${DEFAULT_DEPOSIT_PERCENT}%`;

export function QuoteActions({
  token,
  amount,
  options = [],
  packages = [],
  // Start times from the assigned crew's hours; the default window if unassigned.
  slots = DEFAULT_VISIT_SLOTS,
  // Whether this job's crew can take cards. If not, no deposit button: one that
  // fails on tap is worse than none.
  cardReady = false,
  // How this job's contractor takes payment. With no online card payment, the customer picks from these.
  payMethods = [],
}: {
  token: string;
  amount: number | null;
  options?: PublicOption[];
  packages?: PublicPackage[];
  slots?: string[];
  cardReady?: boolean;
  payMethods?: PayMethod[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [discount, setDiscount] = useState(false);
  // Days that work for them, each with a start time; the crew confirm one.
  const [picks, setPicks] = useState<DayPick[]>([]);
  const [draft, setDraft] = useState("");
  // Time given to newly added days. One control, since few want different
  // hours per day; each row can still be changed.
  const [time, setTime] = useState(slots[1] ?? slots[0] ?? "9:00 AM");
  const [error, setError] = useState("");
  // Consent to electronic records: every Approve button waits on it, and the server refuses an approval without it.
  const [econsent, setEconsent] = useState(false);
  // How they'll pay the contractor (any number); asked when there's no online card payment.
  const [payPicks, setPayPicks] = useState<PayMethod[]>([]);
  const askPay = !cardReady && payMethods.length > 0;
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState<string[]>([]);
  // Yes/no per optional item. Nothing pre-answered: untouched isn't a decision.
  const [answers, setAnswers] = useState<Record<string, "accepted" | "declined">>({});
  // The package they picked. Nothing pre-selected, not even the recommended
  // one: a default would be choosing their price.
  const [picked, setPicked] = useState<string | null>(null);

  // Whether the real Approve button is on screen. On a phone it's far below the
  // price, so a sticky bar with the same button shows until it's in view. Only
  // one CTA visible at a time.
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [ctaOnScreen, setCtaOnScreen] = useState(true);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCtaOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const itemised = options.length > 0;
  const choice = packages.length > 0;
  const optional = options.filter((o) => !o.required);
  const answered = optional.filter((o) => answers[o.id]).length;
  const allAnswered = answered === optional.length;
  const chosen = useMemo(() => packages.find((p) => p.id === picked) ?? null, [packages, picked]);
  // Running total: chosen package + required items + accepted extras.
  const running = useMemo(() => quoteTotal(chosen, options, answers), [chosen, options, answers]);
  // Built price (itemised or a choice) vs one fixed number.
  const built = itemised || choice;
  // The figure every price below is worked from.
  const total = built ? running : (amount ?? 0);
  const canApprove = built ? (!choice || Boolean(chosen)) && allAnswered && total > 0 : amount != null;
  // What still blocks the button, in order, said out loud rather than a silent
  // greyed-out button.
  const todo = !choice || chosen ? optional.length - answered : -1;

  // Same figure as the bottom of the option list, so a credit doesn't show two prices.
  const discountedTotal = discount && total > 0 ? Math.max(0, total - DECLINE_CREDIT) : total;
  // No figure until something is picked: the sum of every option (e.g. "Section
  // 1 / Section 2 / All sections" reading as $24,984) misleads. Once every extra
  // is answered, $0 is a real answer.
  const nothingPicked = choice ? !chosen : running === 0 && !allAnswered;

  // The lines that make up the price, in the crew's order.
  const breakdown = options.filter((o) => o.required);

  // One line: title, price and description, plus yes/no on extras. Shared so
  // the two kinds never drift apart.
  const renderLine = (o: PublicOption) => {
    const answer = answers[o.id];
    const on = o.required || answer === "accepted";
    return (
      <li key={o.id} className={`cq-opt${on ? " cq-opt-on" : ""}${answer === "declined" ? " cq-opt-off" : ""}`}>
        <div className="cq-opt-head">
          <span className="cq-opt-title">{o.title}</span>
          <span className="cq-opt-price">{usd(o.amount)}</span>
        </div>
        {o.description && (
          <SectionText
            text={o.description}
            className="cq-opt-desc"
            chars={110}
            lines={2}
            more="Show details"
            less="Hide details"
          />
        )}
        {o.required ? (
          // In the breakdown every line is included; only say so on a choice
          // quote, where included and optional lines share a list.
          choice && <span className="cq-opt-included">Included in your project</span>
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
  };

  // Both Approve buttons call this, so there's one path into scheduling.
  function approve() {
    setDiscount(false);
    setMode("schedule");
  }

  // Raleigh days, not the phone's zone; the server checks the same floor.
  const minDate = useMemo(() => ymdInDays(LEAD_TIME_DAYS), []);

  // Warn early about a taken day so they don't offer three we can't use.
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
      // Don't block on a failed check; the crew confirm anyway.
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

  // The credit is quoted against what they've picked so far. With nothing
  // picked there's no real figure to strike through, so mode "save" says it in words.
  const offerBase = total;
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
          // Recorded so the crew know what to expect; changes nothing owed.
          pay: action === "accept" ? pay : undefined,
          pay_methods: action === "accept" && askPay ? payPicks : undefined,
          // Two index-aligned arrays: the columns' shape, read by index on the crew card.
          preferred_dates: action === "accept" ? picks.map((p) => p.date) : undefined,
          preferred_times: action === "accept" ? picks.map((p) => p.time) : undefined,
          // Every item, required ones too, so each has a recorded decision.
          options: action === "accept" && itemised ? answersWithRequired(options, answers) : undefined,
          // The server checks it belongs to THIS quote before pricing.
          package: action === "accept" && choice ? (picked ?? undefined) : undefined,
          // The words they agreed to travel with the tick, so the record shows exactly what was on screen.
          econsent: action === "accept" ? { agreed: econsent, version: ECONSENT_VERSION } : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        // Straight to checkout if they chose to pay now. The approval is already
        // recorded, so backing out of Stripe still leaves an approved job.
        if (action === "accept" && pay === "card") {
          setMode("paying");
          router.push(`/pay/${token}`);
          return;
        }
        setMode(action === "accept" ? "accepted" : "declined");
        // Re-render the server page into its confirmed/declined view.
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

  // Approved and heading to Stripe. Its own state: flashing the confirmation
  // panel and then leaving reads as a glitch.
  if (mode === "paying") {
    return (
      <div className="cq-result cq-result-ok">
        <h3>Quote approved. Opening checkout&hellip;</h3>
        <p className="cq-result-note">One moment. If nothing happens, tap the payment link we just texted you.</p>
      </div>
    );
  }

  if (mode === "accepted") {
    const finalPrice = discount ? discounted : total;
    const bought = [
      ...(chosen ? [chosen.title] : []),
      ...options.filter((o) => o.required || answers[o.id] === "accepted").map((o) => o.title),
    ];
    return (
      <div className="cq-result cq-result-ok">
        <h3>Quote approved</h3>
        {bought.length > 0 && <p className="cq-result-note">You approved: {bought.join(", ")}.</p>}
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
        <h3>Quote declined</h3>
        <p className="cq-result-note">Thanks for letting us know. If anything changes, we&apos;re a call or text away.</p>
      </div>
    );
  }

  if (mode === "save") {
    return (
      <div className="cq-offer">
        <h3>Here&apos;s a ${DECLINE_CREDIT} credit to earn your business.</h3>
        {built && running === 0 ? (
          <p className="cq-offer-price">It comes off whichever option you pick.</p>
        ) : (
          <p className="cq-offer-price">
            <s>{usd(offerBase)}</s> <strong>{usd(discounted)}</strong>
          </p>
        )}
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          onClick={() => {
            setDiscount(true);
            // Taking the credit isn't choosing. With items unanswered, go back to
            // them, or the server refuses the approval from the date picker.
            setMode(canApprove ? "schedule" : "choose");
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
        {/* The date input's min already enforces the lead time, so it isn't spelled out here. */}
        <p className="cq-fine">
          Pick up to {MAX_PREFERRED_DATES} days and a start time. We&apos;ll text you to confirm one.
        </p>
        {/* Restate what they're approving before they commit. */}
        {built && (
          <p className="cq-fine cq-sched-scope">
            Approving:{" "}
            {[
              ...(chosen ? [chosen.title] : []),
              ...options.filter((o) => o.required || answers[o.id] === "accepted").map((o) => o.title),
            ].join(", ")}{" "}
            &middot; <strong>{usd(discount ? discounted : total)}</strong>
          </p>
        )}
        {discount && !built && (
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
                {/* Per row, so different days can start at different hours. */}
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

        <label className="cq-consent">
          <input
            type="checkbox"
            checked={econsent}
            onChange={(e) => setEconsent(e.target.checked)}
            disabled={busy}
          />
          {/* The stored words (ECONSENT_TEXT), with the disclosure's title made a link: what is shown is what is kept. */}
          <span>
            {ECONSENT_TEXT.split(ECONSENT_DISCLOSURE_TITLE)[0]}
            <a href={ECONSENT_DISCLOSURE_PATH} target="_blank" rel="noreferrer">
              {ECONSENT_DISCLOSURE_TITLE}
            </a>
            {ECONSENT_TEXT.split(ECONSENT_DISCLOSURE_TITLE)[1]}
          </span>
        </label>

        {/* Asked here only: the moment they've decided. Later by text it's a
            chase; earlier it's a toll booth. Both answers approve, so neither
            is styled as a refusal; paying the crew in cash is fine. */}
        {cardReady ? (
          <div className="cq-pay">
            <p className="cq-pay-lead">
              A {DEPOSIT_LABEL} deposit books your date and covers materials. The rest is due when the work is finished.
            </p>
            <button
              type="button"
              className="cq-btn cq-btn-accept"
              disabled={picks.length === 0 || !econsent || busy}
              onClick={() => submit("accept", "card")}
            >
              {busy ? "Sending…" : `Approve & pay ${money(depositCents(Math.round((discount ? discounted : total) * 100)))} deposit`}
            </button>
            <button
              type="button"
              className="cq-btn cq-pay-alt"
              disabled={picks.length === 0 || !econsent || busy}
              onClick={() => submit("accept", "direct")}
            >
              Approve now, pay the crew directly
            </button>
            <p className="cq-fine cq-pay-fine">Cash, check, Zelle or Venmo on site.</p>
          </div>
        ) : (
          <>
            {askPay && (
              <fieldset className="cq-paywith">
                <legend>How will you pay the contractor?</legend>
                <p className="cq-fine">Pick any that work for you. You pay the contractor directly.</p>
                <div className="cq-paywith-opts">
                  {payMethods.map((m) => (
                    <label key={m} className={payPicks.includes(m) ? "cq-paywith-opt cq-paywith-on" : "cq-paywith-opt"}>
                      <input
                        type="checkbox"
                        checked={payPicks.includes(m)}
                        disabled={busy}
                        onChange={(e) =>
                          setPayPicks((cur) => {
                            const next = e.target.checked ? [...cur, m] : cur.filter((x) => x !== m);
                            return PAYMENT_METHODS.filter((x) => next.includes(x));
                          })
                        }
                      />
                      {METHOD_NAMES[m]}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <button
              type="button"
              className="cq-btn cq-btn-accept"
              disabled={picks.length === 0 || !econsent || (askPay && payPicks.length === 0) || busy}
              onClick={() => submit("accept", "direct")}
            >
              {busy ? "Sending…" : "Approve quote"}
            </button>
            {askPay && payPicks.length === 0 && <p className="cq-fine">Pick how you&apos;ll pay to approve.</p>}
          </>
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
      {/* One panel for the whole decision (approach, extras, total); split, it
          reads as two quotes. */}
      {built && (
        <div className="cq-opts">
          {/* The approach first: the total isn't one until there's a driveway under it. */}
          {choice && (
            <div className="cq-alts">
              <h2 className="cq-opts-title">
                {packages.length === 2 ? "Two ways to do this - pick one" : "Pick the one you'd like"}
              </h2>
              <ul className="cq-alt-list">
                {packages.map((pkg, i) => {
                  const on = picked === pkg.id;
                  return (
                    // The whole card picks it (a radio dot is too small on a
                    // phone); the button is the accessible control and card taps
                    // bubble to it. Long descriptions fold behind "Show details".
                    <li
                      key={pkg.id}
                      className={`cq-alt-card${on ? " cq-alt-on" : ""}${pkg.recommended ? " cq-alt-rec" : ""}`}
                      onClick={() => setPicked(pkg.id)}
                    >
                      <button type="button" className="cq-alt" aria-pressed={on}>
                        <span className="cq-alt-top">
                          {/* Selection is said in the top row, so picking a card doesn't change its height. */}
                          <span className="cq-alt-letter">{`Option ${packageLetter(i)}${on ? " · Selected" : ""}`}</span>
                          {pkg.recommended && <span className="cq-alt-flag">What we&apos;d pick</span>}
                        </span>
                        <span className="cq-alt-head">
                          <span className="cq-alt-title">{pkg.title}</span>
                          <span className="cq-alt-price">{usd(pkg.amount)}</span>
                        </span>
                      </button>
                      {pkg.description && (
                        <SectionText
                          text={pkg.description}
                          className="cq-alt-desc"
                          chars={110}
                          lines={2}
                          more="Show details"
                          less="Hide details"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Two groups: the breakdown (what they pay for, no buttons) and extras
              (the only decisions, so the only buttons). On a choice quote the
              lines sit on top of whichever option is picked. */}
          {itemised && (
            <>
              {choice ? (
                <>
                  <h2 className="cq-opts-title">Anything to add?</h2>
                  {discount && (
                    <p className="cq-fine cq-opt-todo">
                      Your ${DECLINE_CREDIT} credit is held. Answer each option and it comes off the total below.
                    </p>
                  )}
                  <ul className="cq-opt-list">{options.map(renderLine)}</ul>
                </>
              ) : (
                <>
                  {breakdown.length > 0 && (
                    <>
                      <h2 className="cq-opts-title">Price breakdown</h2>
                      <ul className="cq-opt-list cq-breakdown">{breakdown.map(renderLine)}</ul>
                    </>
                  )}
                  {optional.length > 0 && (
                    <>
                      <h2 className="cq-opts-title">{breakdown.length > 0 ? "Optional extras" : "Choose what you'd like"}</h2>
                      {discount && (
                        <p className="cq-fine cq-opt-todo">
                          Your ${DECLINE_CREDIT} credit is held. Answer each option and it comes off the total below.
                        </p>
                      )}
                      <ul className="cq-opt-list">{optional.map(renderLine)}</ul>
                    </>
                  )}
                </>
              )}
            </>
          )}

          <div className="cq-opt-total">
            <span>Your total</span>
            {/* A dash, not $0, until they pick: $0 is a real answer (no to
                everything) and would tell an undecided customer it's free. */}
            <strong>
              {nothingPicked ? "-" : usd(discount && running > 0 ? Math.max(0, running - DECLINE_CREDIT) : running)}
            </strong>
          </div>
          {/* One outstanding thing at a time; both at once reads as form errors. */}
          {todo < 0 ? (
            <p className="cq-fine cq-opt-todo">Pick the option you&apos;d like to go ahead with.</p>
          ) : todo > 0 ? (
            <p className="cq-fine cq-opt-todo">
              {todo === 1 ? "One extra still needs a yes or no." : `${todo} extras still need a yes or no.`}
            </p>
          ) : (
            total === 0 && (
              <p className="cq-fine cq-opt-todo">
                You&apos;ve said no to everything. Use Decline below if none of it is for you.
              </p>
            )
          )}
        </div>
      )}

      <div className="cq-actions" ref={actionsRef}>
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          disabled={!canApprove}
          onClick={approve}
        >
          Approve quote
        </button>
        <button type="button" className="cq-btn cq-btn-decline" onClick={() => setMode("save")}>
          Decline
        </button>
      </div>

      {/* Approving books nothing (they pick days, the crew confirm), so the
          reassurance sits against the button. */}
      <p className="cq-reassure">
        Approving doesn&apos;t book a date. You&apos;ll pick a few days that suit you, and we&apos;ll text you back to
        confirm one.
      </p>

      {/* Phone only, and only while the real button is out of sight. */}
      {!ctaOnScreen && (
        <div className="cq-sticky">
          <span className="cq-sticky-price">
            <span>{built ? "Your total" : "Your price"}</span>
            <strong>{nothingPicked ? "-" : usd(discountedTotal)}</strong>
          </span>
          <button type="button" className="cq-btn cq-btn-accept" disabled={!canApprove} onClick={approve}>
            Approve
          </button>
        </div>
      )}
    </>
  );
}

// Required items are sent as accepted, so the record shows every item answered.
function answersWithRequired(
  options: PublicOption[],
  answers: Record<string, "accepted" | "declined">,
): Record<string, "accepted" | "declined"> {
  const out: Record<string, "accepted" | "declined"> = { ...answers };
  for (const o of options) if (o.required) out[o.id] = "accepted";
  return out;
}
