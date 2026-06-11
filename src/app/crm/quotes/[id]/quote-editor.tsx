"use client";

import { useActionState, useEffect, useState } from "react";

import { STATUSES, STATUS_LABELS } from "@/lib/crm/constants";
import { saveQuote } from "./actions";
import type { SaveState } from "./types";

type ContractorOption = { id: string; label: string };

type Props = {
  id: string;
  isOwner: boolean;
  customerName: string;
  contractors: ContractorOption[];
  initial: {
    status: string;
    assigned_to: string | null;
    quote_amount: number | null;
    quote_summary: string | null;
    internal_notes: string | null;
  };
};

export function QuoteEditor({ id, isOwner, customerName, contractors, initial }: Props) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  // Controlled so the send confirmation always reflects the latest edits.
  const [amount, setAmount] = useState(initial.quote_amount != null ? String(initial.quote_amount) : "");
  const [summary, setSummary] = useState(initial.quote_summary ?? "");
  const [confirming, setConfirming] = useState(false);
  const [localErr, setLocalErr] = useState("");

  // Close the confirmation once the send completes.
  useEffect(() => {
    if (state.sent) setConfirming(false);
  }, [state.sent]);

  const amountNum = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const summaryValid = summary.trim().length > 0;
  const previewPrice = amountValid ? `$${amountNum.toLocaleString("en-US")}` : "—";

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

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Status</span>
          <select name="status" defaultValue={initial.status} className="crm-input">
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
            <select name="assigned_to" defaultValue={initial.assigned_to ?? ""} className="crm-input">
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
          placeholder="What's included, scope, timeline — this is shown to the customer on their quote link."
        />
      </label>

      <label className="crm-field">
        <span>Internal notes (never shown to the customer)</span>
        <textarea
          name="internal_notes"
          rows={3}
          defaultValue={initial.internal_notes ?? ""}
          className="crm-input"
          placeholder="Notes for you and the crew."
        />
      </label>

      {confirming ? (
        <div className="crm-confirm">
          <h3>Send this quote to {customerName.split(" ")[0]}?</h3>
          <p className="crm-muted crm-sm">We&apos;ll text them their branded quote link and mark this Sent.</p>
          <div className="crm-confirm-row">
            <span>Price</span>
            <strong>{previewPrice}</strong>
          </div>
          <div className="crm-confirm-summary">{summary}</div>
          <div className="crm-editor-foot">
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" name="intent" value="send" className="crm-btn crm-btn-send" disabled={pending}>
              {pending ? "Sending…" : "Confirm & send"}
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
              Send Quote
            </button>
            {state.sent && state.smsDelivered && !pending && !state.error && (
              <span className="crm-saved">Quote sent — customer texted</span>
            )}
            {state.sent && !state.smsDelivered && !pending && !state.error && (
              <span className="crm-auth-error">Marked Sent, but the text didn&apos;t go out. Copy the customer link below and send it manually.</span>
            )}
            {state.ok && !state.sent && !pending && !state.error && <span className="crm-saved">Saved</span>}
            {(localErr || state.error) && <span className="crm-auth-error">{localErr || state.error}</span>}
          </div>
          <p className="crm-muted crm-sm crm-editor-hint">
            Price and description are required to send. Send Quote texts the customer their link and marks this Sent.
          </p>
        </>
      )}
    </form>
  );
}
