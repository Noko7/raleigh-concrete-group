"use client";

import { useActionState, useState } from "react";

import { CHANGE_NOTE_MAX, firstNameOf, parseDollars, sameChangeLines, type ChangeLineDraft } from "@/lib/crm/constants";
import { RECORDED_METHODS, usd as money, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { SpellTextarea } from "@/components/spell-field";
import { sendChangeOrder, withdrawChangeOrder } from "./change-order-actions";
import { blankRow, filledRows, OptionBuilder, rowAmount, type OptionRow } from "./option-builder";
import type { ChangeState } from "./types";

// A change order: a small quote on an agreed job (e.g. the patio two feet wider
// a week before the pour). The note goes to the customer verbatim; the figure is
// the new TOTAL, not the difference, so there's one number to get right.
//
// ── Why there is a review step ──
// The customer sees a BALANCE: new total less what's paid, and "paid" is
// whatever the crew recorded. A 50% deposit entered as the whole job makes every
// figure wrong. So step two shows exactly what the customer will see, the
// payments behind it, and a tick saying somebody checked.
export type ChangePayment = {
  id: string;
  method: string;
  amountCents: number;
  /** Net of refunds, which the balance is worked from. */
  netCents: number;
  status: string;
  when: string | null;
  note: string | null;
};

type Step = "closed" | "compose" | "review";

export function ChangeOrder({
  id,
  customerName,
  totalCents,
  paidCents,
  payments,
  bookedFor,
  workCompleted,
  pending,
  lines = [],
  jobHasLines = false,
  canBreakDown = true,
  canApplyAgreed = false,
  locale,
  tone = "dark",
}: {
  id: string;
  customerName: string;
  /** What the job is worth today, in cents. */
  totalCents: number;
  /** Already paid, net of refunds (the deposit). */
  paidCents: number;
  /** Every payment row, so the review shows what the balance was built from. */
  payments: ChangePayment[];
  /** Booked day, formatted, so the preview can say it isn't moving. */
  bookedFor: string | null;
  /** Whether the work is finished; drives the paid-in-full warning. */
  workCompleted: boolean;
  /** The change already waiting on the customer, if there is one. */
  pending: { note: string; amountCents: number; lines?: ChangeLineDraft[] | null; depositCents?: number | null } | null;
  /**
   * Where the breakdown starts: the job as agreed. Its own lines, or one line
   * carrying the agreed total, so an added line is money ON TOP of the job.
   * See changeStartLines.
   */
  lines?: ChangeLineDraft[];
  /** Whether the job has a breakdown today, rather than one price. */
  jobHasLines?: boolean;
  /** False on a job priced as a choice of ways, which stays one figure. */
  canBreakDown?: boolean;
  /**
   * Owner only: offer "already agreed, don't text them" (applies the total with
   * nobody asked), and allow lowering the total. sendChangeOrder enforces both.
   */
  canApplyAgreed?: boolean;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [state, formAction, busy] = useActionState<ChangeState, FormData>(sendChangeOrder, { ok: false });
  const [pullState, pullAction, pulling] = useActionState<ChangeState, FormData>(withdrawChangeOrder, { ok: false });

  const [step, setStep] = useState<Step>("closed");
  const [note, setNote] = useState("");
  // Seeded with today's total: most changes adjust it, and editing a familiar
  // figure beats retyping one onto an agreed job.
  const [amount, setAmount] = useState(String((totalCents / 100).toFixed(2)));
  // Reset on going back to edit: a tick must not survive a changed figure.
  const [checked, setChecked] = useState(false);
  // Optional second deposit, seeded with what the change adds the first time
  // it's ticked (the usual "send us the materials money").
  const [depositOn, setDepositOn] = useState(false);
  const [deposit, setDeposit] = useState("");
  // Already agreed (phone, on site): nobody to ask; applied now, no text.
  const [agreed, setAgreed] = useState(false);
  // Money handed over on the spot, recorded with the change so balances are right.
  const [paidOn, setPaidOn] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [paidMethod, setPaidMethod] = useState<string>("cash");
  // Seeded from the job's lines, like the total: a change edits what was agreed.
  const [rows, setRows] = useState<OptionRow[]>(() =>
    lines.map((l) => ({ ...blankRow(true), title: l.title, description: l.description ?? "", amount: String(l.amount) })),
  );

  const first = firstNameOf(customerName, customerName);
  const card = tone === "light" ? "co co-light" : "co";

  // How the customer's text went. Rendered in whichever branch shows when the
  // send lands: revalidation flips the card to "waiting on the customer", and a
  // message left in the sent branch would be lost. An unsent change is a
  // question never asked, so this must stay visible.
  const delivery = (
    <>
      {state.sent === false && (
        <p className="co-err">
          {fill(t.changeOrder.textFailed, { to: state.smsTo ?? "" })}
          {state.smsError ? ` ${state.smsError}` : ""}
        </p>
      )}
      {state.smsHeldUntil && <p className="co-hint">{fill(t.changeOrder.textHeld, { when: state.smsHeldUntil })}</p>}
    </>
  );

  // Live figures beside the input. With a breakdown the lines ARE the price,
  // each rounded to the cent as the server does, so this matches what's saved.
  const lineDrafts: ChangeLineDraft[] = canBreakDown
    ? filledRows(rows).map((r) => ({
        title: r.title.trim(),
        description: r.description.trim() || null,
        amount: Math.round(rowAmount(r) * 100) / 100,
      }))
    : [];
  const hasLines = lineDrafts.length > 0;
  // The job had a breakdown and this change takes it away.
  const dropsLines = canBreakDown && !hasLines && jobHasLines;
  const linesChanged = canBreakDown && (hasLines || jobHasLines) && !sameChangeLines(lineDrafts, lines);
  const nextCents = hasLines
    ? lineDrafts.reduce((sum, l) => sum + Math.round(l.amount * 100), 0)
    : Math.round(Number(amount) * 100);
  const valid =
    (hasLines || amount.trim() !== "") && Number.isFinite(nextCents) && nextCents >= 0 && nextCents <= 9_999_999_900;
  const diffCents = valid ? nextCents - totalCents : 0;
  const dueCents = valid ? Math.max(0, nextCents - paidCents) : 0;
  // Dropping below what's paid means we owe them; say so before it goes out.
  const refundCents = valid ? Math.max(0, paidCents - nextCents) : 0;
  // Second deposit and remaining balance, checked as the server does. Only while
  // the box is visible: a refund case hides it, and a stale tick must not count.
  const asking = depositOn && refundCents === 0;
  const depositCentsVal = asking ? Math.round(parseDollars(deposit) * 100) : 0;
  const depositProblem = !asking
    ? null
    : !Number.isFinite(depositCentsVal) || depositCentsVal < 100
      ? t.changeOrder.depositTooSmall
      : depositCentsVal > dueCents
        ? fill(t.changeOrder.depositTooMuch, { max: money(dueCents) })
        : null;
  const showDeposit = asking && !depositProblem && valid;
  // A new total, or the same total with a new breakdown, is a real change. The
  // server refuses a contractor's lower total (changeOrderRefusal); flag it early.
  const lowerRefused = !canApplyAgreed && diffCents < 0;
  const composed =
    valid && note.trim().length >= 3 && (diffCents !== 0 || linesChanged) && !depositProblem && !lowerRefused;

  // Paid in full with the work unfinished: the symptom this step exists for.
  // Can be legitimate (paid up front), so it warns; the tick gates sending.
  const readsPaidInFull = totalCents > 0 && paidCents >= totalCents && !workCompleted;
  const counted = payments.filter((p) => p.status === "paid" || p.status === "refunded");

  // One renderer for compose and review, so the approved numbers are the typed ones.
  const sums = (
    <dl className="co-sums">
      <div>
        <dt>{t.changeOrder.reviewApproved}</dt>
        <dd>{money(totalCents)}</dd>
      </div>
      <div>
        <dt>
          {diffCents < 0
            ? t.changeOrder.reviewTakesOff
            : diffCents > 0
              ? t.changeOrder.reviewAdds
              : t.changeOrder.reviewNoChange}
        </dt>
        <dd className={diffCents > 0 ? "co-up" : diffCents < 0 ? "co-down" : undefined}>
          {diffCents === 0 ? t.changeOrder.reviewNone : `${diffCents > 0 ? "+" : "-"}${money(Math.abs(diffCents))}`}
        </dd>
      </div>
      <div className="co-sums-total">
        <dt>{t.changeOrder.reviewNewTotal}</dt>
        <dd>{money(valid ? nextCents : totalCents)}</dd>
      </div>
      {paidCents > 0 && (
        <div>
          <dt>{t.changeOrder.reviewPaid}</dt>
          <dd className="co-down">-{money(paidCents)}</dd>
        </div>
      )}
      <div className="co-sums-strong">
        <dt>{refundCents > 0 ? t.changeOrder.reviewBack2You : t.changeOrder.reviewLeft}</dt>
        <dd>{refundCents > 0 ? money(refundCents) : money(dueCents)}</dd>
      </div>
      {/* Split when a second deposit is asked: what to send now vs at the end. */}
      {showDeposit && (
        <>
          <div className="co-sums-now">
            <dt>{t.changeOrder.sumDueNow}</dt>
            <dd>{money(depositCentsVal)}</dd>
          </div>
          <div>
            <dt>{t.changeOrder.sumRest}</dt>
            <dd>{money(dueCents - depositCentsVal)}</dd>
          </div>
        </>
      )}
    </dl>
  );

  // The breakdown laid out as the customer's page shows it.
  const lineList = (items: ChangeLineDraft[]) => (
    <div className="co-lines">
      <p className="co-label">{t.changeOrder.linesTitle}</p>
      <ul className="co-lines-rows">
        {items.map((l, i) => (
          <li key={i}>
            <span className="co-lines-title">
              {l.title}
              {l.description && <em>{l.description}</em>}
            </span>
            <span className="co-lines-amount">{money(Math.round(Number(l.amount) * 100))}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  // ── A change is already out with the customer ──
  // One at a time, so it's never unclear which figure they answered.
  if (pending) {
    const pendingDiff = pending.amountCents - totalCents;
    return (
      <section className={card}>
        <h2 className="co-title">{t.changeOrder.waitingTitle}</h2>
        <p className="co-lead">{fill(t.changeOrder.waitingLead, { name: first })}</p>

        <p className="co-note-back">{pending.note}</p>
        {pending.lines && pending.lines.length > 0 && lineList(pending.lines)}

        <dl className="co-sums">
          <div>
            <dt>{t.changeOrder.nowTotal}</dt>
            <dd>{money(totalCents)}</dd>
          </div>
          {pending.depositCents != null && pending.depositCents > 0 && (
            <div>
              <dt>{t.changeOrder.pendingDeposit}</dt>
              <dd>{money(pending.depositCents)}</dd>
            </div>
          )}
          <div>
            <dt>{t.changeOrder.proposed}</dt>
            <dd>
              {money(pending.amountCents)}{" "}
              {pendingDiff !== 0 && (
                <span className={pendingDiff > 0 ? "co-up" : "co-down"}>
                  ({pendingDiff > 0 ? "+" : "-"}
                  {money(Math.abs(pendingDiff))})
                </span>
              )}
            </dd>
          </div>
        </dl>

        <p className="co-hint">{t.changeOrder.waitingHint}</p>

        <form action={pullAction} className="co-pull">
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="co-pull-btn" disabled={pulling}>
            {pulling ? t.changeOrder.withdrawing : t.changeOrder.withdraw}
          </button>
        </form>
        {delivery}
        {pullState.error && <p className="co-err">{pullState.error}</p>}
      </section>
    );
  }

  // Sent. Folded to the outcome, including how the customer's text went.
  if (state.ok) {
    return (
      <section className={card}>
        <p className="co-ok">{state.message}</p>
        {state.warning && <p className="co-err">{state.warning}</p>}
        {delivery}
      </section>
    );
  }

  if (step === "closed") {
    return (
      <section className={card}>
        <h2 className="co-title">{t.changeOrder.title}</h2>
        <p className="co-lead">{t.changeOrder.lead}</p>
        <button type="button" className="co-open" onClick={() => setStep("compose")}>
          {t.changeOrder.open}
        </button>
      </section>
    );
  }

  // ── Step 2: what the customer will actually see ─────────────────────────────
  if (step === "review") {
    return (
      <section className={card}>
        <h2 className="co-title">{fill(t.changeOrder.reviewTitle, { name: first })}</h2>

        {/* In the order their page shows them: a preview, not a summary. */}
        <div className="co-preview">
          <p className="co-note-back">{note.trim()}</p>
          {bookedFor && <p className="co-held">{fill(t.changeOrder.reviewDateHeld, { when: bookedFor })}</p>}
          {hasLines && lineList(lineDrafts)}
          {dropsLines && <p className="co-hint">{t.changeOrder.linesGone}</p>}
          {sums}
        </div>

        {refundCents > 0 && (
          <p className="co-warn">{fill(t.changeOrder.refundWarn, { amount: money(refundCents) })}</p>
        )}
        {readsPaidInFull && <p className="co-warn">{t.changeOrder.paidInFullWarn}</p>}

        {/* The payments behind the balance: where a deposit recorded as the
            whole job gets caught, last chance before the customer is asked. */}
        <div className="co-ledger">
          <p className="co-label">{t.changeOrder.ledgerTitle}</p>
          {counted.length === 0 ? (
            <p className="co-hint">{t.changeOrder.ledgerNone}</p>
          ) : (
            <ul className="co-ledger-rows">
              {payments.map((p) => {
                const ignored = p.status !== "paid" && p.status !== "refunded";
                return (
                  <li key={p.id} className={ignored ? "co-ledger-row co-ledger-out" : "co-ledger-row"}>
                    <span className="co-ledger-how">
                      {/* The payments card's label, not the raw value, since the
                          two screens are read side by side. */}
                      {t.payments.methods[p.method as PaymentMethod] ?? p.method}
                      {p.status === "voided" && <em> · {t.changeOrder.ledgerVoided}</em>}
                      {p.status === "pending" && <em> · {t.payments.waiting}</em>}
                    </span>
                    <span className="co-ledger-when">
                      {p.when
                        ? new Date(p.when).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </span>
                    <span className="co-ledger-amount">{money(p.netCents)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* With nothing recorded the risk flips: a deposit taken but never
              written down, so they get asked for the full amount. */}
          <p className="co-hint">{counted.length === 0 ? t.changeOrder.ledgerHintNone : t.changeOrder.ledgerHint}</p>
        </div>

        <form
          className="co-form"
          action={(fd) => {
            fd.set("id", id);
            fd.set("note", note);
          // With lines the server recomputes the total and ignores this.
            fd.set("amount", hasLines ? (nextCents / 100).toFixed(2) : amount);
            if (canBreakDown) {
              fd.set(
                "lines_json",
                JSON.stringify(
                  lineDrafts.map((l) => ({ title: l.title, description: l.description ?? "", amount: l.amount, required: true })),
                ),
              );
            }
          // The server refuses a send without this; the tick is a real gate.
            fd.set("payments_checked", checked ? "yes" : "no");
            fd.set("agreed", agreed ? "yes" : "no");
            fd.set("paid_on", agreed && paidOn ? "yes" : "no");
            fd.set("paid_amount", paidAmount);
            fd.set("paid_method", paidMethod);
            fd.set("deposit_on", asking ? "yes" : "no");
            fd.set("deposit", deposit);
          // The total this preview used; the server refuses if the job was repriced since.
            fd.set("shown_total", String(totalCents));
            formAction(fd);
          }}
        >
          <label className="co-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{counted.length === 0 ? t.changeOrder.confirmTickNone : t.changeOrder.confirmTick}</span>
          </label>

          {canApplyAgreed && (
            <label className="co-check">
              <input type="checkbox" checked={!agreed} onChange={(e) => setAgreed(!e.target.checked)} />
              <span>{t.changeOrder.textTick}</span>
            </label>
          )}
          {agreed && <p className="co-hint">{fill(t.changeOrder.agreedHint, { name: first })}</p>}
          {agreed && (
            <label className="co-check">
              <input
                type="checkbox"
                checked={paidOn}
                onChange={(e) => {
                  setPaidOn(e.target.checked);
                // Seeded with what the change adds: they usually paid the difference.
                  if (e.target.checked && paidAmount === "" && diffCents > 0) {
                    setPaidAmount((Math.min(diffCents, dueCents) / 100).toFixed(2));
                  }
                }}
              />
              <span>{fill(t.changeOrder.paidTick, { name: first })}</span>
            </label>
          )}
          {agreed && paidOn && (
            <div className="co-paid">
              <label className="co-field co-field-amount">
                <span>{t.changeOrder.paidAmount}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="0.00"
                />
              </label>
              <label className="co-field">
                <span>{t.changeOrder.paidMethod}</span>
                <select value={paidMethod} onChange={(e) => setPaidMethod(e.target.value)}>
                  {RECORDED_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t.payments.methods[m as PaymentMethod] ?? m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {agreed && asking && <p className="co-hint">{t.changeOrder.agreedDepositDropped}</p>}

          <div className="co-acts">
            <button type="submit" className="co-go" disabled={busy || !checked || !composed}>
              {busy
                ? t.changeOrder.sending
                : agreed
                  ? t.changeOrder.applyNow
                  : fill(t.changeOrder.sendTo, { name: first })}
            </button>
            <button
              type="button"
              className="co-cancel"
              onClick={() => {
                setStep("compose");
              // A tick belongs to the figures it was made against.
                setChecked(false);
              }}
              disabled={busy}
            >
              {t.changeOrder.reviewBack}
            </button>
          </div>
        </form>

        {state.error && <p className="co-err">{state.error}</p>}
      </section>
    );
  }

  // ── Step 1: compose it ──────────────────────────────────────────────────────
  return (
    <section className={card}>
      <h2 className="co-title">{t.changeOrder.title}</h2>
      <p className="co-lead">{t.changeOrder.lead}</p>

      <div className="co-form">
        <label className="co-field">
          <span>{t.changeOrder.noteLabel}</span>
          {/* Sent word for word, so the hint says so: "extra concrete" can't be approved. */}
          <SpellTextarea
            rows={3}
            maxLength={CHANGE_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.changeOrder.notePlaceholder}
          />
          <em>{t.changeOrder.noteHint}</em>
        </label>

        {/* Optional; the quote's breakdown editor. Empty means one figure. */}
        {canBreakDown && (
          <OptionBuilder
            rows={rows}
            onChange={(next) => {
              setRows(next);
              setChecked(false);
            }}
            labels={{
              ...t.quoteOptions,
              breakdownEmpty: t.changeOrder.breakdownEmpty,
              breakdownHint: t.changeOrder.breakdownHint,
            }}
            mode="breakdown"
          />
        )}

        {/* With lines, the lines own the total, so there's no second figure to type. */}
        {!hasLines && (
          <label className="co-field co-field-amount">
            <span>{t.changeOrder.amountLabel}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <em>{fill(t.changeOrder.amountHint, { now: money(totalCents) })}</em>
          </label>
        )}
        {dropsLines && <p className="co-hint">{t.changeOrder.linesGone}</p>}

        {/* Second deposit: one tick, one figure, hidden until wanted. */}
        {refundCents === 0 && (
          <div className={`co-deposit${depositOn ? " co-deposit-on" : ""}`}>
            <label className="co-check co-deposit-toggle">
              <input
                type="checkbox"
                checked={depositOn}
                onChange={(e) => {
                  const on = e.target.checked;
                  setDepositOn(on);
                  setChecked(false);
                  if (on && deposit.trim() === "") {
                    const seed = Math.max(0, Math.min(diffCents, dueCents));
                    setDeposit(seed > 0 ? (seed / 100).toFixed(2) : "");
                  }
                }}
              />
              <span>
                {t.changeOrder.depositToggle}
                <em>{fill(t.changeOrder.depositHint, { name: first })}</em>
              </span>
            </label>
            {depositOn && (
              <label className="co-field co-field-amount">
                <span>{t.changeOrder.depositLabel}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  value={deposit}
                  onChange={(e) => {
                    setDeposit(e.target.value);
                    setChecked(false);
                  }}
                />
                {depositProblem && <em className="co-deposit-err">{depositProblem}</em>}
              </label>
            )}
          </div>
        )}

        {/* The customer's arithmetic, live. The deposit is already counted: the
            balance is the total minus what's come in. */}
        {sums}

        {lowerRefused && <p className="co-warn">{t.changeOrder.lowerIsOffice}</p>}

        {refundCents > 0 && !lowerRefused && (
          <p className="co-warn">{fill(t.changeOrder.refundWarn, { amount: money(refundCents) })}</p>
        )}

        {diffCents === 0 && valid && (
          <p className="co-hint">{linesChanged ? t.changeOrder.sameTotalNewLines : t.changeOrder.sameTotal}</p>
        )}

        <p className="co-hint">{fill(t.changeOrder.sendHint, { name: first })}</p>

        <div className="co-acts">
          {/* Nothing is sent here; the review shows it as the customer will read it. */}
          <button type="button" className="co-go" disabled={!composed} onClick={() => setStep("review")}>
            {t.changeOrder.review}
          </button>
          <button type="button" className="co-cancel" onClick={() => setStep("closed")}>
            {t.changeOrder.cancel}
          </button>
        </div>
      </div>

      {state.error && <p className="co-err">{state.error}</p>}
    </section>
  );
}
