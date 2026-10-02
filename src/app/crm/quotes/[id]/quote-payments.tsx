"use client";

import { useActionState, useState } from "react";

import { RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, type Locale } from "@/lib/crm/i18n";
import {
  correctRecordedPayment,
  recordManualPayment,
  refundJobPayment,
  sendPayLink,
  voidRecordedPayment,
  type PaymentState,
} from "./payment-actions";

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
  /**
   * Whether an owner may restate this row. Hand-recorded rows only: a card
   * payment is Stripe's word for money that really moved, and editing our copy
   * would leave the two disagreeing with no way to tell which is right.
   *
   * Computed on the server from the row itself (correctableReason), so the
   * button is never offered for something the action would refuse.
   */
  correctable: boolean;
  note: string | null;
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
  feeSettledCents = 0,
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
  /** What the contractor has already sent over by hand for this job. */
  feeSettledCents?: number;
  rows: QuotePaymentRow[];
}) {
  const d = dict(locale);
  const t = d.payments;
  const [linkState, linkAction, linking] = useActionState(sendPayLink, initial);
  const [cashState, cashAction, saving] = useActionState(recordManualPayment, initial);
  const [refundState, refundAction, refunding] = useActionState(refundJobPayment, initial);
  const [fixState, fixAction, fixing] = useActionState(correctRecordedPayment, initial);
  const [voidState, voidAction, voiding] = useActionState(voidRecordedPayment, initial);
  const [openCash, setOpenCash] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // Which row is being corrected, and whether its void branch is showing. One
  // row at a time: two open correction forms on one ledger is how the wrong one
  // gets saved.
  const [fixingRow, setFixingRow] = useState<string | null>(null);
  const [voidingRow, setVoidingRow] = useState<string | null>(null);
  // Which row is asking "are you sure". A disclosure rather than a browser
  // confirm(): the amount going back has to be on screen, in words, next to
  // the button that sends it.
  const [confirming, setConfirming] = useState<string | null>(null);

  const settled = dueCents <= 0 && totalCents > 0;
  const feedback =
    linkState.error || cashState.error || refundState.error || fixState.error || voidState.error ||
    linkState.message || cashState.message || refundState.message || fixState.message || voidState.message;
  const isError = Boolean(
    linkState.error || cashState.error || refundState.error || fixState.error || voidState.error,
  );

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
        {/* Without this the three figures stop adding up the moment a crew
            settles by Zelle: $750 cut, $0 taken by card, $0 still owed. */}
        {feeSettledCents > 0 && (
          <>
            {usd(feeSettledCents)} {t.feeSettledLabel} ·{" "}
          </>
        )}
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
            const isVoided = r.status === "voided";
            return (
              <li key={r.id}>
                <div className={isVoided ? "qp-row qp-row-void" : "qp-row"}>
                  <span className="qp-row-how">
                    {t.methods[r.method as PaymentMethod] ?? r.method}
                    {r.status === "pending" && <em> · {t.waiting}</em>}
                    {isVoided && <em> · {t.voided}</em>}
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
                  {/* Correcting and refunding are two different answers and sit
                      side by side so the difference is visible at the point of
                      choosing: a refund sends money back, a correction says the
                      money never arrived in the first place. */}
                  {isOwner && r.correctable && (
                    <button
                      type="button"
                      className="qp-fix"
                      onClick={() => {
                        setFixingRow(fixingRow === r.id ? null : r.id);
                        setVoidingRow(null);
                      }}
                    >
                      {t.fixOpen}
                    </button>
                  )}
                </div>

                {/* The note, where there is one. On a voided row it carries the
                    reason, which is the only thing that makes a zero-value row
                    on the books readable six months later. */}
                {r.note && <p className="qp-row-note">{r.note}</p>}

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

                {fixingRow === r.id && (
                  <div className="qp-fix-box">
                    <h3 className="qp-fix-title">{t.fixTitle}</h3>
                    {/* Says what this is NOT, first. An owner reaching for
                        Correct when the customer is actually owed money needs
                        to be sent to the refund instead, and the moment to say
                        so is before they have typed a figure. */}
                    <p className="qp-fix-lead">{t.fixLead}</p>
                    <p className="qp-fix-was">
                      {t.fixWas} <strong>{usd(r.amount_cents)}</strong> ·{" "}
                      {t.methods[r.method as PaymentMethod] ?? r.method}
                    </p>

                    <form action={fixAction} className="qp-form">
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="payment_id" value={r.id} />
                      <label className="crm-field">
                        <span>{t.fixAmount}</span>
                        <input
                          className="crm-input"
                          name="amount"
                          type="text"
                          inputMode="decimal"
                          defaultValue={String(fromCents(r.amount_cents))}
                          autoComplete="off"
                          disabled={fixing}
                        />
                        {/* Said before they type, not after the server refuses
                            it: "no deposit came in" is a common enough answer
                            that the way to record it should be on screen. */}
                        <em className="qp-void-hint">{t.fixZeroHint}</em>
                      </label>
                      <label className="crm-field">
                        <span>{t.fixMethod}</span>
                        <select className="crm-input" name="method" defaultValue={r.method} disabled={fixing}>
                          {RECORDED_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {t.methods[m]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="crm-field qp-note">
                        <span>{t.fixNote}</span>
                        <input
                          className="crm-input"
                          name="note"
                          type="text"
                          maxLength={500}
                          defaultValue={r.note ?? ""}
                          disabled={fixing}
                        />
                      </label>
                      <div className="qp-fix-acts">
                        <button type="submit" className="crm-btn crm-btn-primary" disabled={fixing}>
                          {fixing ? t.fixSaving : t.fixSave}
                        </button>
                        <button
                          type="button"
                          className="qp-refund"
                          onClick={() => setFixingRow(null)}
                          disabled={fixing}
                        >
                          {t.fixCancel}
                        </button>
                      </div>
                    </form>

                    {/* Voiding lives inside the correction box rather than next
                        to it: it is the same decision taken further, and keeping
                        it one level down stops it being a button anybody taps by
                        accident on a ledger. */}
                    {voidingRow === r.id ? (
                      <form action={voidAction} className="qp-void">
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="payment_id" value={r.id} />
                        <p className="qp-void-ask">{t.voidAsk.replace("{amount}", usd(r.amount_cents))}</p>
                        <label className="crm-field">
                          <span>{t.voidReason}</span>
                          <input
                            className="crm-input"
                            name="reason"
                            type="text"
                            maxLength={300}
                            required
                            disabled={voiding}
                          />
                          <em className="qp-void-hint">{t.voidReasonHint}</em>
                        </label>
                        <div className="qp-fix-acts">
                          <button type="submit" className="crm-btn crm-btn-danger" disabled={voiding}>
                            {voiding ? t.voiding : t.voidGo}
                          </button>
                          <button
                            type="button"
                            className="qp-refund"
                            onClick={() => setVoidingRow(null)}
                            disabled={voiding}
                          >
                            {t.fixCancel}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button type="button" className="qp-void-open" onClick={() => setVoidingRow(r.id)}>
                        {t.voidOpen}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
