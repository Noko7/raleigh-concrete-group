"use client";

import { useActionState, useEffect, useState } from "react";

import { quoteServiceOptions } from "@/lib/site-data";
import { createQuote, type NewQuoteState } from "./new-quote-actions";

export function NewQuoteForm() {
  const [state, formAction, pending] = useActionState<NewQuoteState, FormData>(createQuote, { ok: false });
  const [open, setOpen] = useState(false);
  const [quoteType, setQuoteType] = useState("");
  // The crew can book an estimate for today - the lead-time floor is a rule
  // for what a customer may request on the website, not for what the office
  // may agree to on a call.
  const today = new Date().toISOString().slice(0, 10);

  // Collapse once it saves - the new lead shows up on the board above via
  // revalidatePath, so a filled-in form left open just invites a duplicate.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setQuoteType("");
    }
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
          <span>Service</span>
          {/* The same list the public form offers, because this is what
              routes the lead to a contractor. A typed "driveway" would not
              match the "Driveway" rule and would quietly fall through. */}
          <select name="service" className="crm-input" defaultValue="">
            <option value="">Not sure yet</option>
            {quoteServiceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-field">
          <span>Quote type</span>
          <select
            name="quote_type"
            className="crm-input"
            value={quoteType}
            onChange={(e) => setQuoteType(e.target.value)}
          >
            <option value="">Not sure yet</option>
            <option value="online">Online - price from photos</option>
            <option value="inperson">In person - book the estimate now</option>
          </select>
        </label>
      </div>

      {/* Booking the estimate while they are still on the phone is the whole
          point of taking the call. Only asked for an in-person quote, since
          that is the only kind where somebody drives out. */}
      {quoteType === "inperson" && (
        <div className="crm-editor-row">
          <label className="crm-field">
            <span>Estimate date</span>
            <input type="date" name="visit_date" className="crm-input" min={today} required />
          </label>
          <label className="crm-field">
            <span>Estimate time</span>
            <input type="time" name="visit_time" className="crm-input" defaultValue="08:00" required />
          </label>
        </div>
      )}

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
