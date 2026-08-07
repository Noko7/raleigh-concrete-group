"use client";

import { useActionState, useState } from "react";

import { deleteContractor } from "./actions";
import type { DeleteState } from "./types";

// Permanent, so it asks for the name to be typed rather than offering a plain
// confirm button. Deactivate is right next to it and is the reversible option.
export function DeleteContractor({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(deleteContractor, { ok: false });
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost ag-delete" onClick={() => setOpen(true)}>
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="crm-editor delete-form">
      <input type="hidden" name="id" value={id} />
      <p className="crm-sm">
        This permanently deletes <strong>{name}</strong> and their login. Their onboarding agreements go too, and any
        jobs assigned to them become unassigned. To just stop their access, use Deactivate instead.
      </p>
      <label className="crm-field">
        <span>Type “{name}” to confirm</span>
        <input name="confirm" className="crm-input" autoComplete="off" required />
      </label>
      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
    </form>
  );
}
