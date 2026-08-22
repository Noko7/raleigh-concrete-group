"use client";

import { useActionState, useEffect, useState } from "react";

import { createQuote, type NewQuoteState } from "./new-quote-actions";

export function NewQuoteForm() {
  const [state, formAction, pending] = useActionState<NewQuoteState, FormData>(createQuote, { ok: false });
  const [open, setOpen] = useState(false);

  // Collapse once it saves - the new lead shows up on the board above via
  // revalidatePath, so a filled-in form left open just invites a duplicate.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(true)}>
        Log a call-in lead
      </button>
    );
  }

  return (
    <form action={formAction} className="crm-editor">
      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Name</span>
          <input name="name" className="crm-input" required autoFocus />
        </label>
        <label className="crm-field">
          <span>Phone</span>
          <input name="phone" type="tel" className="crm-input" placeholder="919-555-0142" required />
        </label>
      </div>

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Service (optional)</span>
          <input name="service" className="crm-input" placeholder="Driveway, patio, …" />
        </label>
        <label className="crm-field">
          <span>Quote type (optional)</span>
          <select name="quote_type" className="crm-input" defaultValue="">
            <option value="">Not sure yet</option>
            <option value="online">Online - price from photos</option>
            <option value="inperson">In person</option>
          </select>
        </label>
      </div>

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Address (optional)</span>
          <input name="address" className="crm-input" placeholder="123 Main St" />
        </label>
        <label className="crm-field">
          <span>City (optional)</span>
          <input name="city" className="crm-input" />
        </label>
      </div>

      <label className="crm-field">
        <span>Email (optional)</span>
        <input name="email" type="email" className="crm-input" />
      </label>

      <label className="crm-field">
        <span>Notes (optional)</span>
        <textarea name="details" className="crm-input" rows={2} placeholder="Whatever they told you on the phone" />
      </label>

      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save lead"}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
    </form>
  );
}
