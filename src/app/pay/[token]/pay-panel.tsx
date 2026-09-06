"use client";

import { useActionState, useState } from "react";

import { fromCents, usd } from "@/lib/crm/fees";
import { beginPayment, type PayState } from "./actions";

const initial: PayState = {};

type Choice = { key: string; label: string; note: string; cents: number };

/**
 * How much, and then go.
 *
 * The amount is a choice, not a text box. A customer who has just approved a
 * $12,000 job and is asked to type a number will either type the wrong one or
 * stop and ring the office; the two amounts anyone actually pays - the deposit
 * that starts the work, or everything - are buttons, with the free-text field
 * kept behind them for the person genuinely splitting it across two cards.
 *
 * One primary action on screen at a time. The button says the amount, because
 * that is the thing being agreed to, and the line under it says exactly what
 * happens next - nobody should be surprised by landing on Stripe.
 */
export function PayPanel({
  token,
  dueCents,
  depositCents,
  paidCents,
  payeeName,
}: {
  token: string;
  dueCents: number;
  depositCents: number;
  paidCents: number;
  payeeName: string;
}) {
  const [state, action, pending] = useActionState(beginPayment, initial);

  // Nothing paid yet: the deposit is what gets the job on the calendar, so it
  // leads. Once something has been paid, there is only one sensible number
  // left and offering a "deposit" again would be inviting them to underpay.
  const fresh = paidCents === 0;
  const choices: Choice[] = fresh
    ? [
        {
          key: "deposit",
          label: usd(depositCents),
          note: "50% deposit - books your date and covers materials",
          cents: depositCents,
        },
        { key: "full", label: usd(dueCents), note: "Pay the whole job now", cents: dueCents },
      ]
    : [{ key: "balance", label: usd(dueCents), note: "The balance on your job", cents: dueCents }];

  const [choice, setChoice] = useState<string>(choices[0].key);
  const [custom, setCustom] = useState("");

  const isCustom = choice === "other";
  const selected = choices.find((c) => c.key === choice);
  // What the button will actually send. The server re-checks all of it.
  const amount = isCustom ? custom.replace(/[$,\s]/g, "") : String(fromCents(selected?.cents ?? 0));
  const customCents = Math.round(Number(amount) * 100);
  const customBad = isCustom && (!Number.isFinite(customCents) || customCents < 100 || customCents > dueCents);

  return (
    <form action={action} className="pay-form">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="amount" value={amount} />

      <div className="pay-choices" role="radiogroup" aria-label="How much would you like to pay?">
        {choices.map((c) => (
          <button
            type="button"
            key={c.key}
            role="radio"
            aria-checked={choice === c.key}
            className={`pay-choice${choice === c.key ? " pay-choice-on" : ""}`}
            onClick={() => setChoice(c.key)}
            disabled={pending}
          >
            <span className="pay-choice-amount">{c.label}</span>
            <span className="pay-choice-note">{c.note}</span>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isCustom}
          className={`pay-choice pay-choice-other${isCustom ? " pay-choice-on" : ""}`}
          onClick={() => setChoice("other")}
          disabled={pending}
        >
          <span className="pay-choice-amount">Another amount</span>
          <span className="pay-choice-note">Paying part of it today</span>
        </button>
      </div>

      {isCustom && (
        <label className="pay-custom">
          <span>How much today?</span>
          <div className="pay-custom-field">
            <span aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="0.00"
              autoComplete="off"
              disabled={pending}
              aria-label="Amount to pay in dollars"
            />
          </div>
          <span className="pay-custom-hint">Up to {usd(dueCents)}.</span>
        </label>
      )}

      {state.error && <p className="pay-err">{state.error}</p>}

      <button type="submit" className="cq-btn cq-btn-accept pay-go" disabled={pending || customBad}>
        {pending ? "Taking you to checkout…" : `Pay ${isCustom && customCents > 0 ? usd(customCents) : (selected ? selected.label : "")}`}
      </button>
      {/* Said before they tap, not after. A customer who lands on a Stripe page
          without expecting one assumes something has gone wrong, and a customer
          whose statement shows a name they don't recognise calls their bank. */}
      <p className="pay-fine">
        Card, Apple Pay and Google Pay, handled securely by Stripe. Your payment goes straight to your crew, and your
        statement will show {payeeName}.
      </p>
    </form>
  );
}
