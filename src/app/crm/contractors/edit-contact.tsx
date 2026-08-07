"use client";

import { useActionState, useEffect, useState } from "react";

import { updateContractorContact } from "./actions";
import type { ContactState } from "./types";

// Their phone is where every job alert goes, so the owner needs to be able to
// correct it directly rather than asking the contractor to sign in and do it.
export function EditContact({
  id,
  name,
  phone,
}: {
  id: string;
  name: string;
  phone: string | null;
}) {
  const [state, formAction, pending] = useActionState<ContactState, FormData>(updateContractorContact, { ok: false });
  const [open, setOpen] = useState(false);

  // Close once the save lands - the row above already shows the new values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(true)}>
        Edit contact
      </button>
    );
  }

  return (
    <form action={formAction} className="crm-editor contact-form">
      <input type="hidden" name="id" value={id} />
      <label className="crm-field">
        <span>Name</span>
        <input name="full_name" className="crm-input" defaultValue={name} />
      </label>
      <label className="crm-field">
        <span>Alert number</span>
        <input
          name="phone"
          type="tel"
          className="crm-input"
          defaultValue={phone ?? ""}
          placeholder="(919) 555-1234"
        />
      </label>
      <p className="crm-muted crm-sm">Leave the number blank to stop texting them job alerts.</p>
      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
    </form>
  );
}
