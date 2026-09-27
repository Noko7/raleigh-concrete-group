"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ymdInDays } from "@/lib/crm/clock";
import { DECLINE_CREDIT, DEFAULT_VISIT_SLOTS, dollars, LEAD_TIME_DAYS, MAX_PREFERRED_DATES, packageLetter, quoteTotal } from "@/lib/crm/constants";
import { SectionText } from "@/components/section-text";
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

// One complete way of doing the job, on a quote that offers a choice of them.
// Unlike the line items above these are mutually exclusive: the customer picks
// exactly one, and the extras are added to whichever they picked.
export type PublicPackage = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  // The contractor's own answer to "which would you pick". At most one card
  // carries it.
  recommended: boolean;
};

function pretty(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
const usd = (n: number) => dollars(n) ?? "$0";
const DEPOSIT_LABEL = `${DEFAULT_DEPOSIT_PERCENT}%`;

export function QuoteActions({
  token,
  amount,
  options = [],
  packages = [],
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
  packages?: PublicPackage[];
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
  // Which way of doing the job they picked, on a quote that offers a choice.
  // Nothing is pre-selected, not even the recommended one: a default here is us
  // choosing a price for them and hoping they don't notice.
  const [picked, setPicked] = useState<string | null>(null);

  // Whether the real Approve button is on screen. On a phone the decision sits
  // below the price, the trust lines, what's included and, on an itemised
  // quote, every option - which is a long way to scroll back up from if you
  // decided somewhere in the middle. A bar carries the price and the same
  // button until the real one comes into view, and gets out of the way the
  // moment it does: one CTA visible at a time, never two.
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
  // What they are buying right now: the way of doing it they picked, plus every
  // required item, plus the optional ones they've said yes to.
  const running = useMemo(() => quoteTotal(chosen, options, answers), [chosen, options, answers]);
  // Whether the price on this page is built rather than fixed. On a quote that
  // is neither itemised nor a choice there is one number and it never moves.
  const built = itemised || choice;
  // The figure every price below is worked from.
  const total = built ? running : (amount ?? 0);
  const canApprove = built ? (!choice || Boolean(chosen)) && allAnswered && total > 0 : amount != null;
  // What still stands between them and the button, in the order they'd hit it.
  // Said out loud rather than left as a greyed-out button with no explanation.
  const todo = !choice || chosen ? optional.length - answered : -1;

  // What the bar shows, which has to be the number at the bottom of the option
  // list rather than the raw total: a customer holding a credit should not see
  // two different prices depending on where they are looking.
  const discountedTotal = discount && total > 0 ? Math.max(0, total - DECLINE_CREDIT) : total;
  // No figure at all until they have picked something. Before that the only
  // numbers available are $0 or the sum of everything on offer, and the sum is
  // the one that does damage: a quote written as "Section 1 / Section 2 / All
  // sections" read as $24,984 to a customer who wanted one of them. Once they
  // have answered every extra, $0 is a real answer (they said no to it all).
  const nothingPicked = choice ? !chosen : running === 0 && !allAnswered;

  // Both Approve buttons do exactly this, so there is one path into scheduling
  // rather than two that can drift.
  function approve() {
    setDiscount(false);
    setMode("schedule");
  }

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

  // What the save offer is quoted against: what they have picked so far. On a
  // quote with options somebody can reach it having picked nothing, and then
  // there is no figure to strike through - the all-in number is every option
  // added together, which is no price anybody was ever going to pay - so the
  // offer is made in words instead (see mode "save").
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
          // Which way of doing the job they went with. The server checks it is
          // one of the packages on THIS quote before it prices anything.
          package: action === "accept" && choice ? (picked ?? undefined) : undefined,
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
    const bought = [
      ...(chosen ? [chosen.title] : []),
      ...options.filter((o) => o.required || answers[o.id] === "accepted").map((o) => o.title),
    ];
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">Quote approved</p>
        <h3>Thanks! We&apos;ll confirm your date shortly</h3>
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
            // Taking the credit is not the same as having chosen. On an
            // itemised quote with questions still open, this goes back to them
            // rather than to the calendar - otherwise they land on the date
            // picker and the server refuses the approval they thought they gave.
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
        <p className="cq-fine">
          Pick up to {MAX_PREFERRED_DATES} days that suit you, starting {LEAD_TIME_DAYS} days from now, and the time
          you&apos;d like us to start. Our crew will confirm one of them and text you back. Nothing is booked until
          then.
        </p>
        {/* What they are approving, carried into this step: the decision they
            just made is two taps behind them and worth restating before they
            commit to it. */}
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
      {/* One panel holds the whole decision: which way of doing it, then what
          to add to it, then the number those two answers make. Split across two
          boxes they read as two quotes, and the total belongs under both. */}
      {built && (
        <div className="cq-opts">
          {/* The choice of approach comes first and is answered first. Nothing
              below it means anything until it has been: the extras are priced
              the same either way, but the total isn't a total until there is a
              driveway under it. */}
          {choice && (
            <div className="cq-alts">
              <h2 className="cq-opts-title">
                {packages.length === 2 ? "Two ways to do this - pick one" : "Pick the one you'd like"}
              </h2>
              <p className="cq-fine cq-alts-lead">
                Same job, done differently. Tap the one you want and your total is worked out below. Not sure? Call or
                text us and we&apos;ll talk it through.
              </p>
              <ul className="cq-alt-list">
                {packages.map((pkg, i) => {
                  const on = picked === pkg.id;
                  return (
                    // The whole card picks it: a radio dot beside a price is a
                    // target the size of a pea on the phone most of these are
                    // read on. The button is the accessible control; a tap
                    // anywhere else on the card bubbles up to the same answer.
                    // A long description folds to two lines with its own
                    // "Show details", which reads more without picking.
                    <li
                      key={pkg.id}
                      className={`cq-alt-card${on ? " cq-alt-on" : ""}${pkg.recommended ? " cq-alt-rec" : ""}`}
                      onClick={() => setPicked(pkg.id)}
                    >
                      <button type="button" className="cq-alt" aria-pressed={on}>
                        <span className="cq-alt-top">
                          <span className="cq-alt-letter">{`Option ${packageLetter(i)}`}</span>
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
                      <span className="cq-alt-mark">{on ? "Selected" : "Tap to choose"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* The whole point of an itemised quote: each extra is its own yes or
              no, and the total underneath moves as they answer. Nothing is
              ticked for them, so the number they end up approving is one they
              built. */}
          {itemised && (
            <>
              <h2 className="cq-opts-title">{choice ? "Anything to add?" : "Choose what you'd like"}</h2>
              {choice && (
                <p className="cq-fine cq-alts-lead">These are priced the same whichever option you picked above.</p>
              )}
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
            </>
          )}

          <div className="cq-opt-total">
            <span>Your total</span>
            {/* A dash, not $0, until they have picked. Zero is a real answer on
                an itemised quote - they said no to everything - and printing it
                at somebody who simply hasn't chosen yet is the page telling
                them their driveway is free. */}
            <strong>
              {nothingPicked ? "-" : usd(discount && running > 0 ? Math.max(0, running - DECLINE_CREDIT) : running)}
            </strong>
          </div>
          {/* One outstanding thing at a time, in the order they meet them.
              Listing both at once reads as a form with errors rather than a
              decision half made. */}
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

      {/* The hesitation this page actually meets is "am I committing to a date
          I haven't checked yet". Approving does not book anything - the next
          step asks which days suit them and the crew confirms one - so the
          sentence that says so belongs against the button, not three sections
          further up. */}
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
