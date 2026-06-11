"use client";

import { useActionState } from "react";

import { savePrimaryContractor } from "./actions";
import type { SaveState } from "./types";

type Option = { id: string; label: string };

const initial: SaveState = { ok: true };

export function PrimaryContractorForm({ contractors, current }: { contractors: Option[]; current: string | null }) {
  const [state, formAction, pending] = useActionState(savePrimaryContractor, initial);

  return (
    <form action={formAction} className="crm-card crm-settings">
      <h2 className="crm-card-title">Primary contractor</h2>
      <p className="crm-muted crm-sm">Every new quote is auto-assigned to this person. You can reassign any job later.</p>

      <label className="crm-field">
        <span>Auto-assign new quotes to</span>
        <select className="crm-input" name="primary_contractor_id" defaultValue={current ?? ""}>
          <option value="">No one (leave unassigned)</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.saved && !state.error && <p className="crm-saved">Saved.</p>}

      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save primary contractor"}
      </button>
    </form>
  );
}
