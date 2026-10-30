"use client";

import { useActionState, useState } from "react";

import { recordManualPayment, sendPayLink, type PaymentState } from "@/app/crm/quotes/[id]/payment-actions";
import { RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill, intlLocale, type Locale } from "@/lib/crm/i18n";
import { ReceiptBox } from "@/components/receipt-box";

const initial: PaymentState = { ok: false };

export type PaymentRow = {
  id: string;
  method: string;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  /** Office cut in cents. Non-zero only on card rows. */
  fee_cents: number;
};

const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * What the customer owes, what the crew owes the office, send a card link, or record what was handed over.
 * Card and cash sit side by side, neither styled as the fallback: if cash is the sad path, crews work
 * around the app. The fee is always stated in full (cut, rate, paid, left).
 */
export function JobPayments({
  id,
  locale,
  cardReady,
  totalCents,
  paidCents,
  dueCents,
  dueNowCents = 0,
  feeTotalCents,
  feeRate,
  feeRateFrozen,
  feeCollectedCents,
  feeDueCents,
  feeSettledCents = 0,
  feeWaivedCents = 0,
  rows,
}: {
  id: string;
  locale: Locale;
  cardReady: boolean;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  /** Cents. 0 when none. */
  dueNowCents?: number;
  /** Cents. */
  feeTotalCents: number;
  feeRate: number;
  /** False until the first payment; the rate can still change before then. */
  feeRateFrozen: boolean;
  /** Cents taken out of card payments. */
  feeCollectedCents: number;
  feeDueCents: number;
  /** Cents already sent to the office for this job. */
  feeSettledCents?: number;
  /** Cents; already excluded from feeTotalCents. */
  feeWaivedCents?: number;
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

      {/* Collect this first. */}
      {!settled && dueNowCents > 0 && (
        <p className="jp-now">{fill(t.dueNow, { now: usd(dueNowCents), rest: usd(dueCents - dueNowCents) })}</p>
      )}

      {/* The lines under it always add up to it; only the last note depends on how the job is paid. */}
      <div className={`jp-fee${feeDueCents > 0 ? " jp-fee-owed" : ""}`}>
        <span className="jp-fee-label">{t.feeTitle}</span>
        <strong>{usd(feeTotalCents)}</strong>
        <span className="jp-fee-note">
          {fill(feeRateFrozen ? t.feeRate : t.feeRateLocks, { rate: pct(feeRate), total: usd(totalCents) })}
          {feeWaivedCents > 0 && ` ${fill(t.feeWaivedCrew, { amount: usd(feeWaivedCents) })}`}
        </span>
        <dl className="jp-fee-split">
          <div>
            <dt>{t.feePaidCard}</dt>
            <dd>{usd(feeCollectedCents)}</dd>
          </div>
          <div>
            <dt>{t.feePaidHand}</dt>
            <dd>{usd(feeSettledCents)}</dd>
          </div>
          <div className="jp-fee-left">
            <dt>{t.feeStillOwed}</dt>
            <dd>{usd(feeDueCents)}</dd>
          </div>
        </dl>
        <span className="jp-fee-note">
          {feeDueCents <= 0
            ? feeSettledCents > 0
              ? t.owedSettled
              : t.owedNone
            : cardReady && dueCents > 0
              ? t.owedCard
              : t.owedCash}
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
                {/* Buttons, not a select: filled in one-handed, outdoors. */}
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
                      // Seeded with the deposit when one is due, else the balance. Never the full balance while a deposit is
                      // due: that's how a deposit got recorded as paid in full.
                      defaultValue={String(fromCents(dueNowCents > 0 ? dueNowCents : dueCents))}
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

                <ReceiptBox label={t.receiptBox} hint={t.receiptHint} disabled={saving} />

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
              <li
                key={r.id}
                className={
                  r.status === "voided"
                    ? "jp-row jp-row-void"
                    : r.status === "pending"
                      ? "jp-row jp-row-pending"
                      : "jp-row"
                }
              >
                <span className="jp-row-how">{t.methods[r.method as PaymentMethod] ?? r.method}</span>
                <span className="jp-row-when">
                  {new Date(r.paid_at ?? r.created_at).toLocaleDateString(intlLocale(locale), {
                    month: "short",
                    day: "numeric",
                  })}
                  {r.status === "pending" && ` · ${t.waiting}`}
                  {/* Shown here too so both screens count the row the same way. */}
                  {r.status === "voided" && ` · ${t.voided}`}
                  {r.refunded_cents > 0 && ` · ${usd(r.refunded_cents)} ${t.refunded}`}
                  {(r.status === "paid" || r.status === "refunded") &&
                    r.fee_cents > 0 &&
                    ` · ${fill(t.rowFee, { amount: usd(r.fee_cents) })}`}
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
