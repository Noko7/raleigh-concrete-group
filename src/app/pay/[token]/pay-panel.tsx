"use client";

import { useActionState, useState } from "react";

import { cleanAmount } from "@/lib/crm/constants";
import { fromCents, usd } from "@/lib/crm/fees";
import { beginPayment, type PayState } from "./actions";

const initial: PayState = {};

type Choice = { key: string; label: string; note: string; cents: number };

/**
 * How much, and then go. Amounts are buttons (deposit or everything), with a
 * free-text field behind them for splitting across cards: asked to type a
 * number, people mistype or call the office. The button states the amount and
 * the line under it says Stripe is next.
 */
export function PayPanel({
  token,
  dueCents,
  depositCents,
  dueNowCents = 0,
  paidCents,
  payeeName,
}: {
  token: string;
  dueCents: number;
  depositCents: number;
  /** Unpaid second deposit from an approved change. 0 when none. */
  dueNowCents?: number;
  paidCents: number;
  payeeName: string;
}) {
  const [state, action, pending] = useActionState(beginPayment, initial);

  // Nothing paid yet: the deposit leads (it books the job). After any payment,
  // offering a "deposit" again would invite underpaying.
  const fresh = paidCents === 0;
  // A change asked for money up front: that leads, with the full balance beside it.
  const secondDeposit = dueNowCents > 0 && dueNowCents < dueCents;
  const choices: Choice[] = secondDeposit
    ? [
        {
          key: "deposit2",
          label: usd(dueNowCents),
          note: "Deposit for your change - covers the added materials",
          cents: dueNowCents,
        },
        { key: "full", label: usd(dueCents), note: "Pay the whole balance now", cents: dueCents },
      ]
    : fresh
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
  // What the button will send. The server re-checks all of it.
  const amount = isCustom ? cleanAmount(custom) : String(fromCents(selected?.cents ?? 0));
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
      {/* Said before they tap: an unexpected Stripe page looks like an error,
          and an unrecognised statement name prompts a call to the bank. */}
      <p className="pay-fine">
        Card, Apple Pay and Google Pay, handled securely by Stripe. Your payment goes straight to your crew, and your
        statement will show {payeeName}.
      </p>
    </form>
  );
}
