"use client";

import { useActionState, useState } from "react";

import { RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import {
  correctRecordedPayment,
  recordManualPayment,
  refundJobPayment,
  sendPayLink,
  setFeeWaiver,
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
  /** Only a card payment that reached Stripe can be refunded from here. */
  refundable: boolean;
  /**
   * Hand-recorded rows only (card rows are Stripe's record). Computed server-side by correctableReason so
   * the button never offers what the action would refuse.
   */
  correctable: boolean;
  note: string | null;
  /** Office cut in cents. Non-zero only on card rows. */
  fee_cents: number;
};

/**
 * The office's view of one job's money: the same ledger and actions the crew has, plus refunds (which move
 * money out of someone else's Stripe balance).
 */
export function QuotePayments({
  id,
  locale,
  isOwner,
  cardReady,
  totalCents,
  paidCents,
  dueCents,
  dueNowCents = 0,
  feeTotalCents,
  feeRate,
  feeCollectedCents,
  feeDueCents,
  feeSettledCents = 0,
  feeWaivedCents = 0,
  feeWaivedNote = null,
  rows,
}: {
  id: string;
  locale: Locale;
  isOwner: boolean;
  cardReady: boolean;
  totalCents: number;
  paidCents: number;
  dueCents: number;
  /** Cents. 0 when none. */
  dueNowCents?: number;
  feeTotalCents: number;
  feeRate: number;
  feeCollectedCents: number;
  feeDueCents: number;
  /** Cents sent over by hand for this job. */
  feeSettledCents?: number;
  /** Cents taken off the office fee by the owner on this job. */
  feeWaivedCents?: number;
  feeWaivedNote?: string | null;
  rows: QuotePaymentRow[];
}) {
  const d = dict(locale);
  const t = d.payments;
  const [linkState, linkAction, linking] = useActionState(sendPayLink, initial);
  const [cashState, cashAction, saving] = useActionState(recordManualPayment, initial);
  const [refundState, refundAction, refunding] = useActionState(refundJobPayment, initial);
  const [fixState, fixAction, fixing] = useActionState(correctRecordedPayment, initial);
  const [voidState, voidAction, voiding] = useActionState(voidRecordedPayment, initial);
  const [waiveState, waiveAction, waiving] = useActionState(setFeeWaiver, initial);
  const [openWaive, setOpenWaive] = useState(false);
  const [openCash, setOpenCash] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // One row at a time, so the wrong one doesn't get saved.
  const [fixingRow, setFixingRow] = useState<string | null>(null);
  const [voidingRow, setVoidingRow] = useState<string | null>(null);
  // Not confirm(): the amount going back must be on screen next to the button.
  const [confirming, setConfirming] = useState<string | null>(null);

  const settled = dueCents <= 0 && totalCents > 0;
  const feedback =
    linkState.error || cashState.error || refundState.error || fixState.error || voidState.error || waiveState.error ||
    linkState.message || cashState.message || refundState.message || fixState.message || voidState.message ||
    waiveState.message;
  const isError = Boolean(
    linkState.error || cashState.error || refundState.error || fixState.error || voidState.error || waiveState.error,
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

      {!settled && dueNowCents > 0 && (
        <p className="qp-now">{fill(t.dueNow, { now: usd(dueNowCents), rest: usd(dueCents - dueNowCents) })}</p>
      )}

      {/* Split three ways so nobody has to subtract: earned, taken by Stripe, still owed. */}
      <p className="crm-muted crm-sm qp-fee">
        {t.officeCut}: <strong>{usd(feeTotalCents)}</strong> ({Math.round(feeRate * 1000) / 10}%) ·{" "}
        {usd(feeCollectedCents)} {t.feeTaken} ·{" "}
        {/* Without this the figures don't add up once a crew settles by Zelle. */}
        {feeSettledCents > 0 && (
          <>
            {usd(feeSettledCents)} {t.feeSettledLabel} ·{" "}
          </>
        )}
        <strong className={feeDueCents > 0 ? "qp-owed" : ""}>{usd(feeDueCents)}</strong> {t.feeLeft}
        {feeWaivedCents > 0 && (
          <>
            {" "}· {usd(feeWaivedCents)} {t.feeWaivedLabel}
            {feeWaivedNote ? ` (${feeWaivedNote})` : ""}
          </>
        )}
      </p>

      {/* Owner only: e.g. a change order that passed materials through at cost. 0 clears it. */}
      {isOwner && (
        <>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpenWaive((v) => !v)}>
            {openWaive ? d.common.close : t.waiveOpen}
          </button>
          {openWaive && (
            <form action={waiveAction} className="qp-form">
              <input type="hidden" name="id" value={id} />
              <label className="crm-field">
                <span>{fill(t.waiveAmount, { fee: usd(feeTotalCents + feeWaivedCents) })}</span>
                <input
                  className="crm-input"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  defaultValue={feeWaivedCents > 0 ? String(fromCents(feeWaivedCents)) : ""}
                  placeholder="0.00"
                  autoComplete="off"
                  disabled={waiving}
                />
              </label>
              <label className="crm-field qp-note">
                <span>{t.noteLabel}</span>
                <input
                  className="crm-input"
                  name="note"
                  type="text"
                  maxLength={500}
                  defaultValue={feeWaivedNote ?? ""}
                  placeholder={t.waiveNoteHint}
                  disabled={waiving}
                />
              </label>
              <button type="submit" className="crm-btn crm-btn-primary" disabled={waiving}>
                {waiving ? t.recording : t.waiveSave}
              </button>
            </form>
          )}
        </>
      )}

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
              defaultValue={String(fromCents(dueNowCents > 0 ? dueNowCents : dueCents))}
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
                    {(r.status === "paid" || r.status === "refunded") && r.fee_cents > 0 && (
                      <em> · {fill(t.rowFee, { amount: usd(r.fee_cents) })}</em>
                    )}
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
                  {/* Side by side so the difference is visible: a refund sends money back, a correction says it never arrived. */}
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

                {/* On a voided row this carries the reason. */}
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
                    {/* Says what this is NOT before any figure is typed: if the customer is owed money, refund instead. */}
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
                        {/* Shown up front: "no deposit came in" is a common answer. */}
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

                    {/* Inside the correction box so it's never tapped by accident. */}
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
