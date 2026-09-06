"use client";

import { useActionState, useState } from "react";

import { RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, type Locale } from "@/lib/crm/i18n";
import { recordManualPayment, refundJobPayment, sendPayLink, type PaymentState } from "./payment-actions";

const initial: PaymentState = { ok: false };

export type QuotePaymentRow = {
  id: string;
  method: string;
  amount_cents: number;
  refunded_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  /** Only a card payment that reached Stripe can be sent back from here. */
  refundable: boolean;
};

/**
 * The office's view of one job's money.
 *
 * Deliberately the same ledger and the same two actions the crew has on their
 * own page, rather than a separate owner-only way of doing it. The one thing
 * that lives only here is the refund, because it moves money out of somebody
 * else's Stripe balance.
 *
 * This replaced a "Get paid" card that offered a Zelle text and a Mark paid
 * button. Mark paid wrote a timestamp and nothing else, so a job could read as
 * paid with no money recorded against it - and once there is a real ledger,
 * two different answers to "has this been paid" on one screen is worse than
 * either of them alone.
 */
export function QuotePayments({
  id,
  locale,
  isOwner,
  cardReady,
  totalCents,
  paidCents,
  dueCents,
  feeTotalCents,
  feeCollectedCents,
  feeDueCents,
  rows,
}: {
  id: string;
  locale: Locale;
  isOwner: boolean;
  cardReady: boolean;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  feeTotalCents: number;
  feeCollectedCents: number;
  feeDueCents: number;
  rows: QuotePaymentRow[];
}) {
  const d = dict(locale);
  const t = d.payments;
  const [linkState, linkAction, linking] = useActionState(sendPayLink, initial);
  const [cashState, cashAction, saving] = useActionState(recordManualPayment, initial);
  const [refundState, refundAction, refunding] = useActionState(refundJobPayment, initial);
  const [openCash, setOpenCash] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // Which row is asking "are you sure". A disclosure rather than a browser
  // confirm(): the amount going back has to be on screen, in words, next to
  // the button that sends it.
  const [confirming, setConfirming] = useState<string | null>(null);

  const settled = dueCents <= 0 && totalCents > 0;
  const feedback =
    linkState.error || cashState.error || refundState.error ||
    linkState.message || cashState.message || refundState.message;
  const isError = Boolean(linkState.error || cashState.error || refundState.error);

  if (totalCents <= 0) {
    return (
      <div className="crm-card">
        <h2 className="crm-card-title">{t.title}</h2>
        <p className="crm-muted crm-sm">{t.noPrice}</p>
      </div>
    );
  }

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">{t.title}</h2>

      <div className="qp-figures">
        <div className={settled ? "qp-fig qp-fig-clear" : "qp-fig qp-fig-due"}>
          <span>{settled ? t.settled : t.due}</span>
          <strong>{usd(settled ? paidCents : dueCents)}</strong>
        </div>
        <div className="qp-fig">
          <span>{t.total}</span>
          <strong>{usd(totalCents)}</strong>
        </div>
        <div className="qp-fig">
          <span>{t.paid}</span>
          <strong>{usd(paidCents)}</strong>
        </div>
      </div>

      {/* The office's cut, split three ways so nobody has to do the subtraction:
          what the job earns, what Stripe already took, what is still owed.
          Said in the office's voice - the crew's card says "you owe", which is
          the same fact from the other side of the table. */}
      <p className="crm-muted crm-sm qp-fee">
        {t.officeCut}: <strong>{usd(feeTotalCents)}</strong> · {usd(feeCollectedCents)} {t.feeTaken} ·{" "}
        <strong className={feeDueCents > 0 ? "qp-owed" : ""}>{usd(feeDueCents)}</strong> {t.feeLeft}
      </p>

      {!settled && (
        <div className="crm-editor-foot qp-actions">
          {cardReady && (
            <form action={linkAction}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="crm-btn crm-btn-ghost" disabled={linking}>
                {linking ? t.cardSending : t.cardSend}
              </button>
            </form>
          )}
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpenCash((v) => !v)}>
            {openCash ? d.common.close : t.record}
          </button>
        </div>
      )}
      {!settled && !cardReady && <p className="crm-muted crm-sm">{t.cardOff}</p>}

      {openCash && !settled && (
        <form action={cashAction} className="qp-form">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="method" value={method} />
          <label className="crm-field">
            <span>{t.method}</span>
            <select
              className="crm-input"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              disabled={saving}
            >
              {RECORDED_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t.methods[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="crm-field">
            <span>{t.amount}</span>
            <input
              className="crm-input"
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={String(fromCents(dueCents))}
              autoComplete="off"
              disabled={saving}
            />
          </label>
          <label className="crm-field qp-note">
            <span>{t.noteLabel}</span>
            <input className="crm-input" name="note" type="text" maxLength={500} disabled={saving} />
          </label>
          <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>
            {saving ? t.recording : t.record}
          </button>
        </form>
      )}

      {feedback && <p className={isError ? "crm-auth-error" : "crm-saved"}>{feedback}</p>}

      {rows.length > 0 && (
        <ul className="qp-rows">
          {rows.map((r) => {
            const back = r.amount_cents - r.refunded_cents;
            return (
              <li key={r.id}>
                <div className="qp-row">
                  <span className="qp-row-how">
                    {t.methods[r.method as PaymentMethod] ?? r.method}
                    {r.status === "pending" && <em> · {t.waiting}</em>}
                    {r.refunded_cents > 0 && <em> · {usd(r.refunded_cents)} {t.refunded}</em>}
                  </span>
                  <span className="qp-row-when">
                    {new Date(r.paid_at ?? r.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="qp-row-amount">{usd(back)}</span>
                  {isOwner && r.refundable && back > 0 && (
                    <button
                      type="button"
                      className="qp-refund"
                      onClick={() => setConfirming(confirming === r.id ? null : r.id)}
                    >
                      {t.refund}
                    </button>
                  )}
                </div>
                {confirming === r.id && (
                  <form action={refundAction} className="qp-confirm">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="payment_id" value={r.id} />
                    <span>{t.refundAsk.replace("{amount}", usd(back))}</span>
                    <button type="submit" className="crm-btn crm-btn-danger" disabled={refunding}>
                      {refunding ? t.refunding : `${t.refund} ${usd(back)}`}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
