"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { STATUSES, STATUS_LABELS } from "@/lib/crm/constants";
import { saveQuote } from "./actions";
import type { SaveState } from "./types";

type ContractorOption = { id: string; label: string };

type Props = {
  id: string;
  isOwner: boolean;
  customerName: string;
  // Already texted and no answer yet. The owner can still send it again - a
  // customer saying "I never got it" is real and somebody has to be able to
  // act on it - but it becomes a deliberate second send rather than a repeat
  // of the same click.
  awaitingReply: boolean;
  contractors: ContractorOption[];
  initial: {
    status: string;
    assigned_to: string | null;
    quote_amount: number | null;
    quote_summary: string | null;
    internal_notes: string | null;
  };
};

export function QuoteEditor({ id, isOwner, customerName, awaitingReply, contractors, initial }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  // Everything is controlled so the form always shows the saved truth. When the
  // server data changes (after a save, or a customer action elsewhere) we resync
  // the fields to it - that's the "stateful" behaviour the board needs.
  const [status, setStatus] = useState(initial.status);
  const [assigned, setAssigned] = useState(initial.assigned_to ?? "");
  const [amount, setAmount] = useState(initial.quote_amount != null ? String(initial.quote_amount) : "");
  const [summary, setSummary] = useState(initial.quote_summary ?? "");
  const [notes, setNotes] = useState(initial.internal_notes ?? "");
  const [confirming, setConfirming] = useState(false);
  const [localErr, setLocalErr] = useState("");

  const initialSig = useMemo(
    () =>
      [
        initial.status,
        initial.assigned_to ?? "",
        initial.quote_amount ?? "",
        initial.quote_summary ?? "",
        initial.internal_notes ?? "",
      ].join("|"),
    [initial],
  );
  useEffect(() => {
    setStatus(initial.status);
    setAssigned(initial.assigned_to ?? "");
    setAmount(initial.quote_amount != null ? String(initial.quote_amount) : "");
    setSummary(initial.quote_summary ?? "");
    setNotes(initial.internal_notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSig]);

  // After any successful save/send, pull fresh server data so the status badge,
  // activity log and the rest of the page reflect the change immediately.
  useEffect(() => {
    if (state.sent) setConfirming(false);
    if (state.ok || state.sent) router.refresh();
  }, [state, router]);

  const amountNum = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const summaryValid = summary.trim().length > 0;
  const previewPrice = amountValid ? `$${amountNum.toLocaleString("en-US")}` : "N/A";

  function openConfirm() {
    if (!amountValid && !summaryValid) {
      setLocalErr("Add a price and a customer-facing description before sending.");
    } else if (!amountValid) {
      setLocalErr("Add a quote price before sending.");
    } else if (!summaryValid) {
      setLocalErr("Add a customer-facing description before sending.");
    } else {
      setLocalErr("");
      setConfirming(true);
    }
  }

  return (
    <form action={formAction} className="crm-card crm-editor">
      <input type="hidden" name="id" value={id} />
      {/* The intent rides on a hidden field rather than the submit button's
          name/value. Relying on the submitter meant that if it didn't reach the
          server the action silently fell through to "save": no text sent, no
          activity logged, and a green "Saved" as if it had worked. The confirm
          panel is only open when sending, so this can't disagree with the
          button the user actually pressed. */}
      {/* Opening the confirm panel on a quote that's already out IS the
          deliberate act the server asks for, so it sends "resend" rather than
          bouncing off the duplicate guard and making the owner hunt for a
          second button. The panel says plainly what that means. */}
      <input type="hidden" name="intent" value={confirming ? (awaitingReply ? "resend" : "send") : "save"} />

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Status</span>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="crm-input">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        {isOwner && (
          <label className="crm-field">
            <span>Assigned contractor</span>
            <select name="assigned_to" value={assigned} onChange={(e) => setAssigned(e.target.value)} className="crm-input">
              <option value="">Unassigned</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="crm-field">
          <span>Quote amount ($) *</span>
          <input
            type="number"
            name="quote_amount"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="crm-input"
            placeholder="e.g. 6500"
          />
        </label>
      </div>

      <label className="crm-field">
        <span>Customer-facing quote summary *</span>
        <textarea
          name="quote_summary"
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="crm-input"
          placeholder="What's included, scope, timeline. This is shown to the customer on their quote link."
        />
      </label>

      <label className="crm-field">
        <span>Internal notes (never shown to the customer)</span>
        <textarea
          name="internal_notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="crm-input"
          placeholder="Notes for you and the crew."
        />
      </label>

      {confirming ? (
        <div className="crm-confirm">
          <h3>
            {awaitingReply ? "Send this quote again" : "Send this quote"} to {customerName.split(" ")[0]}?
          </h3>
          <p className="crm-muted crm-sm">
            {awaitingReply
              ? "They already have this quote and haven't replied. Sending again puts a second copy on their phone — do it if they say the first never arrived."
              : "We'll text them their branded quote link and mark this Sent."}
          </p>
          <div className="crm-confirm-row">
            <span>Price</span>
            <strong>{previewPrice}</strong>
          </div>
          <div className="crm-confirm-summary">{summary}</div>
          <div className="crm-editor-foot">
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            {/* No name/value: the hidden intent field above is the single source
                of truth, and a second "intent" here could only disagree with it. */}
            <button type="submit" className="crm-btn crm-btn-send" disabled={pending}>
              {pending ? "Sending…" : awaitingReply ? "Send again" : "Confirm & send"}
            </button>
          </div>
          {state.error && !pending && <p className="crm-auth-error crm-confirm-error">{state.error}</p>}
        </div>
      ) : (
        <>
          <div className="crm-editor-foot">
            <button type="submit" name="intent" value="save" className="crm-btn crm-btn-ghost" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="crm-btn crm-btn-send" onClick={openConfirm} disabled={pending}>
              {awaitingReply ? "Send Quote again" : "Send Quote"}
            </button>
            {state.ok && !state.sent && !pending && !state.error && <span className="crm-saved">Saved</span>}
            {(localErr || state.error) && <span className="crm-auth-error">{localErr || state.error}</span>}
          </div>

          {/* Sending is the one action with a real-world outcome, so it gets an
              unambiguous banner rather than a line of grey text. */}
          {state.sent && !pending && !state.error && (
            <div className={`send-result ${state.smsDelivered ? "send-result-ok" : "send-result-bad"}`}>
              <strong>
                {state.smsDelivered
                  ? `Quote sent — texted to ${state.smsTo ?? "the customer"}`
                  : "Quote saved, but the text did NOT go out"}
              </strong>
              {!state.smsDelivered && (
                <>
                  <p className="crm-sm">
                    The quote link is live, so copy the customer link below and send it yourself. Then check Settings →
                    Text notifications.
                  </p>
                  {state.smsError && <pre className="send-result-detail">{state.smsError}</pre>}
                </>
              )}
            </div>
          )}
          <p className="crm-muted crm-sm crm-editor-hint">
            Price and description are required to send. Send Quote texts the customer their link and marks this Sent.
          </p>
        </>
      )}
    </form>
  );
}
