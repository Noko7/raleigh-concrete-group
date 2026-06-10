"use client";

import { useActionState } from "react";

import { STATUSES, STATUS_LABELS } from "@/lib/crm/constants";
import { saveQuote } from "./actions";
import type { SaveState } from "./types";

type ContractorOption = { id: string; label: string };

type Props = {
  id: string;
  isOwner: boolean;
  contractors: ContractorOption[];
  initial: {
    status: string;
    assigned_to: string | null;
    quote_amount: number | null;
    quote_summary: string | null;
    internal_notes: string | null;
  };
};

export function QuoteEditor({ id, isOwner, contractors, initial }: Props) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

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
          <span>Quote amount ($)</span>
          <input
            type="number"
            name="quote_amount"
            min={0}
            step="0.01"
            defaultValue={initial.quote_amount ?? ""}
            className="crm-input"
            placeholder="e.g. 6500"
          />
        </label>
      </div>

      <label className="crm-field">
        <span>Customer-facing quote summary</span>
        <textarea
          name="quote_summary"
          rows={4}
          defaultValue={initial.quote_summary ?? ""}
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

      <div className="crm-editor-foot">
        <button type="submit" name="intent" value="save" className="crm-btn crm-btn-ghost" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="submit" name="intent" value="send" className="crm-btn crm-btn-send" disabled={pending}>
          {pending ? "Working…" : "Send Quote"}
        </button>
        {state.sent && !pending && !state.error && <span className="crm-saved">Quote sent to customer</span>}
        {state.ok && !state.sent && !pending && !state.error && <span className="crm-saved">Saved</span>}
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
      <p className="crm-muted crm-sm crm-editor-hint">
        Send Quote texts the customer their branded quote link and marks this Sent. Save changes just stores your edits.
      </p>
    </form>
  );
}
