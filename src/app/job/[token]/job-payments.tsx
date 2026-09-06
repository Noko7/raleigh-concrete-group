"use client";

import { useActionState, useState } from "react";

import { recordManualPayment, sendPayLink, type PaymentState } from "@/app/crm/quotes/[id]/payment-actions";
import { RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, type Locale } from "@/lib/crm/i18n";

const initial: PaymentState = { ok: false };

export type PaymentRow = {
  id: string;
  method: string;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

/**
 * The crew's money card.
 *
 * Two numbers and two buttons, in that order, because that is the whole job:
 * what the customer still owes, what the crew owes the office, send a card
 * link, or write down what was handed over.
 *
 * The two ways to get paid sit side by side and neither is styled as the
 * fallback. Half of these jobs settle in cash in a driveway, and an app that
 * treats that as the sad path is an app the crew works around - which is how
 * the office ends up finding out about $4,000 three weeks later.
 *
 * The fee line is stated plainly and always, even when it is zero. A percentage
 * somebody discovers at the end of a month is a percentage they argue about.
 */
export function JobPayments({
  id,
  locale,
  cardReady,
  totalCents,
  paidCents,
  dueCents,
  feeDueCents,
  rows,
}: {
  id: string;
  locale: Locale;
  cardReady: boolean;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  feeDueCents: number;
  rows: PaymentRow[];
}) {
  const t = dict(locale).payments;
  const [linkState, linkAction, linking] = useActionState(sendPayLink, initial);
  const [cashState, cashAction, saving] = useActionState(recordManualPayment, initial);
  const [openCash, setOpenCash] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");

  const settled = dueCents <= 0 && totalCents > 0;
  const feedback = linkState.error || cashState.error || linkState.message || cashState.message;
  const isError = Boolean(linkState.error || cashState.error);

  if (totalCents <= 0) {
    return (
      <section className="js-card jp">
        <h2 className="js-title">{t.title}</h2>
        <p className="js-lead">{t.noPrice}</p>
      </section>
    );
  }

  return (
    <section className="js-card jp">
      <h2 className="js-title">{t.title}</h2>

      <div className={`jp-head${settled ? " jp-head-clear" : ""}`}>
        <span className="jp-head-label">{settled ? t.settled : t.due}</span>
        <strong className="jp-head-value">{usd(settled ? paidCents : dueCents)}</strong>
        <dl className="jp-split">
          <div>
            <dt>{t.total}</dt>
            <dd>{usd(totalCents)}</dd>
          </div>
          <div>
            <dt>{t.paid}</dt>
            <dd>{usd(paidCents)}</dd>
          </div>
        </dl>
      </div>

      {/* What they owe the office, and how it gets there. Only the second line
          changes: the fee is the same either way, and only the route differs. */}
      <div className={`jp-fee${feeDueCents > 0 ? " jp-fee-owed" : ""}`}>
        <span className="jp-fee-label">{t.owedTitle}</span>
        <strong>{usd(feeDueCents)}</strong>
        <span className="jp-fee-note">
          {feeDueCents <= 0 ? t.owedNone : cardReady && dueCents > 0 ? t.owedCard : t.owedCash}
        </span>
      </div>

      {!settled && (
        <div className="jp-ways">
          <div className="jp-way">
            <h3>{t.cardTitle}</h3>
            <p>{cardReady ? t.cardLead : t.cardOff}</p>
            {cardReady && (
              <form action={linkAction}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="js-confirm" disabled={linking}>
                  {linking ? t.cardSending : t.cardSend}
                </button>
              </form>
            )}
          </div>

          <div className="jp-way">
            <h3>{t.cashTitle}</h3>
            <p>{t.cashLead}</p>
            {!openCash ? (
              <button type="button" className="js-confirm jp-ghost" onClick={() => setOpenCash(true)}>
                {t.record}
              </button>
            ) : (
              <form action={cashAction} className="jp-form">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="method" value={method} />

                <span className="jp-label">{t.method}</span>
                {/* Buttons, not a dropdown. This is filled in one-handed on a
                    phone, outdoors, and a select is three taps and a scroll. */}
                <div className="jp-methods" role="radiogroup" aria-label={t.method}>
                  {RECORDED_METHODS.map((m) => (
                    <button
                      type="button"
                      key={m}
                      role="radio"
                      aria-checked={method === m}
                      className={`jp-method${method === m ? " jp-method-on" : ""}`}
                      onClick={() => setMethod(m)}
                      disabled={saving}
                    >
                      {t.methods[m]}
                    </button>
                  ))}
                </div>

                <label className="jp-field">
                  <span>{t.amount}</span>
                  <div className="jp-amount">
                    <span aria-hidden="true">$</span>
                    <input
                      name="amount"
                      type="text"
                      inputMode="decimal"
                      // Seeded with the balance because that is what a crew is
                      // usually handed, and they can type over it in one tap.
                      defaultValue={String(fromCents(dueCents))}
                      autoComplete="off"
                      disabled={saving}
                    />
                  </div>
                </label>

                <label className="jp-field">
                  <span>{t.noteLabel}</span>
                  <input
                    name="note"
                    type="text"
                    className="jp-input"
                    placeholder={t.notePlaceholder}
                    maxLength={500}
                    disabled={saving}
                  />
                </label>

                <button type="submit" className="js-confirm" disabled={saving}>
                  {saving ? t.recording : t.record}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {feedback && <p className={isError ? "js-err" : "js-ok"}>{feedback}</p>}

      {rows.length > 0 && (
        <>
          <h3 className="jp-history-title">{t.history}</h3>
          <ul className="jp-history">
            {rows.map((r) => (
              <li key={r.id} className={r.status === "pending" ? "jp-row jp-row-pending" : "jp-row"}>
                <span className="jp-row-how">{t.methods[r.method as PaymentMethod] ?? r.method}</span>
                <span className="jp-row-when">
                  {new Date(r.paid_at ?? r.created_at).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                  {r.status === "pending" && ` · ${t.waiting}`}
                  {r.refunded_cents > 0 && ` · ${usd(r.refunded_cents)} ${t.refunded}`}
                </span>
                <span className="jp-row-amount">{usd(r.amount_cents - r.refunded_cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
