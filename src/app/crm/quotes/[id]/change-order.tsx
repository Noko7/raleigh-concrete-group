"use client";

import { useActionState, useState } from "react";

import { CHANGE_NOTE_MAX, sameChangeLines, type ChangeLineDraft } from "@/lib/crm/constants";
import { usd as money, type PaymentMethod } from "@/lib/crm/fees";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { sendChangeOrder, withdrawChangeOrder } from "./actions";
import { blankRow, filledRows, OptionBuilder, rowAmount, type OptionRow } from "./option-builder";
import type { ChangeState } from "./types";

// The customer rang a week before the pour wanting the patio two feet wider.
//
// Everything about the job is settled by then - approved, booked, deposit in -
// so there was no honest way to move the price. The quote editor is for a price
// nobody has accepted yet, and an owner typing a new figure into it changes what
// the customer owes without the customer agreeing to it.
//
// So this card is a small quote: say what is changing, say what the job is worth
// now, send it. Two fields, because two is what the job needs - the words go to
// the customer verbatim and the figure is the new TOTAL, not the difference, so
// there is one number to get right instead of two that can contradict.
//
// ── Why there is a review step ──
//
// A change order is not really about a total, it is about a BALANCE: what the
// customer sees is "new total, less what you've paid, leaves this". That second
// line comes from whatever the crew recorded as paid, and the crew can get it
// wrong - a 50% deposit entered as the whole job is one tap on a form whose
// amount box is pre-filled with the outstanding balance. When that happens every
// figure the customer is about to read is wrong, and they are being asked to
// approve it.
//
// So sending is two steps, not one. The second shows exactly what the customer
// will see, the payments it was all worked out from, and a tick saying somebody
// looked. The tick is not ceremony: it is the difference between a figure
// nobody checked and a figure somebody is answerable for.
export type ChangePayment = {
  id: string;
  method: string;
  amountCents: number;
  /** Net of refunds, which is what the balance is actually worked from. */
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
  canBreakDown = true,
  locale,
  tone = "dark",
}: {
  id: string;
  customerName: string;
  /** What the job is worth today, in cents. */
  totalCents: number;
  /** What the customer has already handed over, net of refunds. The deposit. */
  paidCents: number;
  /**
   * Every payment row on the job, so the review step can show the figures the
   * balance was built from rather than asking anyone to trust the total.
   */
  payments: ChangePayment[];
  /** Their booked day, already formatted, so the preview can promise it is safe. */
  bookedFor: string | null;
  /** Whether the work itself is finished - decides the paid-in-full warning. */
  workCompleted: boolean;
  /** The change already waiting on the customer, if there is one. */
  pending: { note: string; amountCents: number; lines?: ChangeLineDraft[] | null } | null;
  /**
   * The job's breakdown as it stands: what the customer bought. A change starts
   * from these, so the crew edit lines the customer already agreed to.
   */
  lines?: ChangeLineDraft[];
  /** False on a job priced as a choice of ways, which stays one figure. */
  canBreakDown?: boolean;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [state, formAction, busy] = useActionState<ChangeState, FormData>(sendChangeOrder, { ok: false });
  const [pullState, pullAction, pulling] = useActionState<ChangeState, FormData>(withdrawChangeOrder, { ok: false });

  const [step, setStep] = useState<Step>("closed");
  const [note, setNote] = useState("");
  // Seeded with today's total rather than blank or zero: almost every change is
  // an adjustment to this number, and starting from it means the crew edit a
  // figure they recognise instead of typing a total from scratch and
  // fat-fingering a digit onto a job that is already agreed.
  const [amount, setAmount] = useState(String((totalCents / 100).toFixed(2)));
  // Ticked on the review step. Reset whenever they go back to edit, because a
  // tick that survives a changed figure is a tick against something else.
  const [checked, setChecked] = useState(false);
  // The breakdown, when there is one. Seeded from the job's own lines for the
  // same reason the total is seeded: a change is an edit to what was agreed.
  const [rows, setRows] = useState<OptionRow[]>(() =>
    lines.map((l) => ({ ...blankRow(true), title: l.title, description: l.description ?? "", amount: String(l.amount) })),
  );

  const first = customerName.trim().split(/\s+/)[0] || customerName;
  const card = tone === "light" ? "co co-light" : "co";

  // How the customer's text went, rendered in whichever branch the card is
  // showing when the send lands.
  //
  // This has to follow the card rather than live in one branch, because sending
  // revalidates the page: the server comes back with a pending change on the
  // job, so the card re-renders into its "waiting on the customer" state and any
  // message left behind in the sent branch would never be seen. A change order
  // whose text didn't go out is a question the customer was never asked, and the
  // crew would sit waiting for an answer to it - so of everything on this card,
  // this is the part that must not get lost.
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

  // The numbers the crew are deciding between, worked out live so the
  // consequence of the figure they are typing is on screen beside it.
  //
  // With a breakdown the lines ARE the price: the new total is their sum, each
  // rounded to the cent the same way the server rounds it, so the figure on
  // this screen is the figure that gets saved.
  const lineDrafts: ChangeLineDraft[] = canBreakDown
    ? filledRows(rows).map((r) => ({
        title: r.title.trim(),
        description: r.description.trim() || null,
        amount: Math.round(rowAmount(r) * 100) / 100,
      }))
    : [];
  const hasLines = lineDrafts.length > 0;
  // The job had a breakdown and this change takes it away.
  const dropsLines = canBreakDown && !hasLines && lines.length > 0;
  const linesChanged = canBreakDown && (hasLines || lines.length > 0) && !sameChangeLines(lineDrafts, lines);
  const nextCents = hasLines
    ? lineDrafts.reduce((sum, l) => sum + Math.round(l.amount * 100), 0)
    : Math.round(Number(amount) * 100);
  const valid =
    (hasLines || amount.trim() !== "") && Number.isFinite(nextCents) && nextCents >= 0 && nextCents <= 9_999_999_900;
  const diffCents = valid ? nextCents - totalCents : 0;
  const dueCents = valid ? Math.max(0, nextCents - paidCents) : 0;
  // Dropping the scope below what they have already paid means we owe them,
  // which is a different conversation and has to be said out loud before the
  // change goes out rather than discovered afterwards.
  const refundCents = valid ? Math.max(0, paidCents - nextCents) : 0;
  // A new total, or the same total with a new breakdown: "same price, but show
  // me where it goes" is a real change for the customer to approve.
  const composed = valid && note.trim().length >= 3 && (diffCents !== 0 || linesChanged);

  // The symptom of the bug this whole step exists for: the job says it is fully
  // paid and nobody has finished the work. It can be legitimate - a customer may
  // genuinely pay up front - so it warns rather than blocks, which is why the
  // tick below is the thing that actually gates sending.
  const readsPaidInFull = totalCents > 0 && paidCents >= totalCents && !workCompleted;
  const counted = payments.filter((p) => p.status === "paid" || p.status === "refunded");

  // The three live figures, shared by the compose panel and the review. One
  // renderer so the numbers somebody approves on the second screen are provably
  // the numbers they typed on the first.
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
    </dl>
  );

  // The breakdown as the customer will read it, set the same way their page
  // sets it: one line per row, price on the right.
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
  // One at a time, so there is never a question of which figure they answered.
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

        {/* Their words and their figures, in the order their own page shows
            them, so this screen is a preview and not a summary of one. */}
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

        {/* The payments the balance above was built from. This is the part that
            catches a deposit recorded as the whole job: the figure is wrong in a
            way no amount of staring at the total will reveal, and right here is
            the last moment before a customer is asked to approve it. */}
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
                      {/* The same label the payments card uses, not the raw
                          column value: this screen is read side by side with
                          that one, and "cash" against "Cash" invites the
                          question of whether they are the same row. */}
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
          {/* With nothing recorded the risk turns round. It is no longer a
              deposit counted as the whole job, it is a deposit that WAS taken
              and never written down - and then the customer gets asked for the
              full amount. Same tick, saying the opposite thing. */}
          <p className="co-hint">{counted.length === 0 ? t.changeOrder.ledgerHintNone : t.changeOrder.ledgerHint}</p>
        </div>

        <form
          className="co-form"
          action={(fd) => {
            fd.set("id", id);
            fd.set("note", note);
            // With a breakdown the total is its sum. The server works it out
            // again from the lines and never trusts this figure for it.
            fd.set("amount", hasLines ? (nextCents / 100).toFixed(2) : amount);
            if (canBreakDown) {
              fd.set(
                "lines_json",
                JSON.stringify(
                  lineDrafts.map((l) => ({ title: l.title, description: l.description ?? "", amount: l.amount, required: true })),
                ),
              );
            }
            // The server refuses a send without this, so the tick is a real
            // gate rather than a disabled button somebody can get around.
            fd.set("payments_checked", checked ? "yes" : "no");
            // The total this preview was drawn against. The server refuses the
            // send if the job has been repriced since, rather than letting a
            // reviewed difference go out against a figure nobody saw.
            fd.set("shown_total", String(totalCents));
            formAction(fd);
          }}
        >
          <label className="co-check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{counted.length === 0 ? t.changeOrder.confirmTickNone : t.changeOrder.confirmTick}</span>
          </label>

          <div className="co-acts">
            <button type="submit" className="co-go" disabled={busy || !checked || !composed}>
              {busy ? t.changeOrder.sending : fill(t.changeOrder.sendTo, { name: first })}
            </button>
            <button
              type="button"
              className="co-cancel"
              onClick={() => {
                setStep("compose");
                // A tick belongs to the figures that were on screen when it was
                // made. Going back to change them takes it with you.
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
          {/* Goes to the customer word for word, so the hint says so. A change
              described as "extra concrete" is a change nobody can approve. */}
          <textarea
            rows={3}
            maxLength={CHANGE_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.changeOrder.notePlaceholder}
          />
          <em>{t.changeOrder.noteHint}</em>
        </label>

        {/* Optional, and the same breakdown editor the quote uses, so a crew who
            has broken one price down knows this one already. Leave it empty and
            the change is one figure, exactly as before. */}
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

        {/* With lines, the lines own the total: the breakdown above adds it
            up and the sums below carry it, so there is no box to type a
            second, different figure into. */}
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

        {/* The customer's arithmetic, shown as it is typed. This panel is the
            answer to "what about the deposit": it is already counted, because the
            balance has always been the total minus what has come in. */}
        {sums}

        {refundCents > 0 && (
          <p className="co-warn">{fill(t.changeOrder.refundWarn, { amount: money(refundCents) })}</p>
        )}
        {diffCents === 0 && valid && (
          <p className="co-hint">{linesChanged ? t.changeOrder.sameTotalNewLines : t.changeOrder.sameTotal}</p>
        )}

        <p className="co-hint">{fill(t.changeOrder.sendHint, { name: first })}</p>

        <div className="co-acts">
          {/* Nothing is sent from this screen. The next one shows it as the
              customer will read it, with the payments behind it. */}
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
