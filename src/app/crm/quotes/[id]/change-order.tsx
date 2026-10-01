"use client";

import { useActionState, useState } from "react";

import { CHANGE_NOTE_MAX } from "@/lib/crm/constants";
import { usd as money } from "@/lib/crm/fees";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { sendChangeOrder, withdrawChangeOrder } from "./actions";
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
// The maths underneath is the whole reason it stays this simple. The ledger has
// always been "what the job is worth now, minus what has been collected", so
// approving a new total is all it takes for the deposit to keep counting: the
// panel below just shows the customer's own arithmetic back to the crew before
// they commit to it.
export function ChangeOrder({
  id,
  customerName,
  totalCents,
  paidCents,
  pending,
  locale,
  tone = "dark",
}: {
  id: string;
  customerName: string;
  /** What the job is worth today, in cents. */
  totalCents: number;
  /** What the customer has already handed over, net of refunds. The deposit. */
  paidCents: number;
  /** The change already waiting on the customer, if there is one. */
  pending: { note: string; amountCents: number } | null;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [state, formAction, busy] = useActionState<ChangeState, FormData>(sendChangeOrder, { ok: false });
  const [pullState, pullAction, pulling] = useActionState<ChangeState, FormData>(withdrawChangeOrder, { ok: false });

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  // Seeded with today's total rather than blank or zero: almost every change is
  // an adjustment to this number, and starting from it means the crew edit a
  // figure they recognise instead of typing a total from scratch and fat
  // -fingering a digit onto a job that is already agreed.
  const [amount, setAmount] = useState(String((totalCents / 100).toFixed(2)));

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

  // The three numbers the crew are really deciding between, worked out live so
  // the consequence of the figure they are typing is on screen beside it.
  const nextCents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(nextCents) && nextCents >= 0 && nextCents <= 9_999_999_900;
  const diffCents = valid ? nextCents - totalCents : 0;
  const dueCents = valid ? Math.max(0, nextCents - paidCents) : 0;
  // Dropping the scope below what they have already paid means we owe them,
  // which is a different conversation and has to be said out loud before the
  // change goes out rather than discovered afterwards.
  const refundCents = valid ? Math.max(0, paidCents - nextCents) : 0;
  const ready = valid && note.trim().length >= 3 && diffCents !== 0;

  // ── A change is already out with the customer ──
  // One at a time, so there is never a question of which figure they answered.
  if (pending) {
    const pendingDiff = pending.amountCents - totalCents;
    return (
      <section className={card}>
        <h2 className="co-title">{t.changeOrder.waitingTitle}</h2>
        <p className="co-lead">{fill(t.changeOrder.waitingLead, { name: first })}</p>

        <p className="co-note-back">{pending.note}</p>

        <dl className="co-sums">
          <div>
            <dt>{t.changeOrder.nowTotal}</dt>
            <dd>{money(totalCents)}</dd>
          </div>
          <div>
            <dt>{t.changeOrder.proposed}</dt>
            <dd>
              {money(pending.amountCents)}{" "}
              <span className={pendingDiff > 0 ? "co-up" : "co-down"}>
                ({pendingDiff > 0 ? "+" : "-"}
                {money(Math.abs(pendingDiff))})
              </span>
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

  // Sent. Folded to the outcome, including how the customer's text went - a
  // change nobody was told about is a change that will never be answered.
  if (state.ok) {
    return (
      <section className={card}>
        <p className="co-ok">{state.message}</p>
        {delivery}
      </section>
    );
  }

  if (!open) {
    return (
      <section className={card}>
        <h2 className="co-title">{t.changeOrder.title}</h2>
        <p className="co-lead">{t.changeOrder.lead}</p>
        <button type="button" className="co-open" onClick={() => setOpen(true)}>
          {t.changeOrder.open}
        </button>
      </section>
    );
  }

  return (
    <section className={card}>
      <h2 className="co-title">{t.changeOrder.title}</h2>
      <p className="co-lead">{t.changeOrder.lead}</p>

      <form
        className="co-form"
        action={(fd) => {
          fd.set("id", id);
          formAction(fd);
        }}
      >
        <label className="co-field">
          <span>{t.changeOrder.noteLabel}</span>
          {/* Goes to the customer word for word, so the hint says so. A change
              described as "extra concrete" is a change nobody can approve. */}
          <textarea
            name="note"
            rows={3}
            maxLength={CHANGE_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.changeOrder.notePlaceholder}
            required
          />
          <em>{t.changeOrder.noteHint}</em>
        </label>

        <label className="co-field co-field-amount">
          <span>{t.changeOrder.amountLabel}</span>
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <em>{fill(t.changeOrder.amountHint, { now: money(totalCents) })}</em>
        </label>

        {/* The customer's arithmetic, shown to the crew before they send it.
            This panel is the answer to "what about the deposit": it is already
            counted, because the balance has always been the total minus what
            has come in. */}
        <dl className="co-sums">
          <div>
            <dt>{t.changeOrder.difference}</dt>
            <dd className={diffCents > 0 ? "co-up" : diffCents < 0 ? "co-down" : undefined}>
              {diffCents === 0 ? "-" : `${diffCents > 0 ? "+" : "-"}${money(Math.abs(diffCents))}`}
            </dd>
          </div>
          <div>
            <dt>{t.changeOrder.alreadyPaid}</dt>
            <dd>{money(paidCents)}</dd>
          </div>
          <div className="co-sums-strong">
            <dt>{t.changeOrder.newBalance}</dt>
            <dd>{money(dueCents)}</dd>
          </div>
        </dl>

        {refundCents > 0 && (
          <p className="co-warn">{fill(t.changeOrder.refundWarn, { amount: money(refundCents) })}</p>
        )}
        {diffCents === 0 && valid && <p className="co-hint">{t.changeOrder.sameTotal}</p>}

        <p className="co-hint">{fill(t.changeOrder.sendHint, { name: first })}</p>

        <div className="co-acts">
          <button type="submit" className="co-go" disabled={busy || !ready}>
            {busy ? t.changeOrder.sending : t.changeOrder.send}
          </button>
          <button type="button" className="co-cancel" onClick={() => setOpen(false)} disabled={busy}>
            {t.changeOrder.cancel}
          </button>
        </div>
      </form>

      {state.error && <p className="co-err">{state.error}</p>}
    </section>
  );
}
