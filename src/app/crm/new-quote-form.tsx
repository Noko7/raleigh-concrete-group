"use client";

import { useActionState, useEffect, useState } from "react";

import { quoteServiceOptions } from "@/lib/site-data";
import { createQuote, type NewQuoteState } from "./new-quote-actions";

type ContractorOption = { id: string; label: string };

export function NewQuoteForm({ contractors }: { contractors: ContractorOption[] }) {
  const [state, formAction, pending] = useActionState<NewQuoteState, FormData>(createQuote, { ok: false });
  const [open, setOpen] = useState(false);
  const [quoteType, setQuoteType] = useState("");
  const [sendText, setSendText] = useState(false);
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
      setSendText(false);
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
            <option value="plans">From plans - no visit, price off the drawings</option>
          </select>
        </label>
      </div>

      {/* Auto is the default and matches what a web lead does. The override
          is here because a commercial job is often a specific person's work
          regardless of what the job-type rules say. */}
      <label className="crm-field">
        <span>Assign to</span>
        <select name="assigned_to" className="crm-input" defaultValue="">
          <option value="">Auto - by job type</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

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

      {/* Off by default. A call-in lead normally needs no text at all - you
          just spoke to them - so this is for the case where you promised
          something on the call and want it in writing. */}
      <fieldset className="crm-sections">
        <legend>
          <label className="svc-check">
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            <span>Text the customer now</span>
          </label>
        </legend>
        {sendText && (
          <>
            <textarea
              name="custom_message"
              className="crm-input"
              rows={4}
              maxLength={1000}
              required
              placeholder="Hi Dana, great speaking with you. Send over the plan set whenever you're ready and we'll get pricing back to you this week."
            />
            <p className="crm-muted crm-sm">
              Sent exactly as written, signed off with the business name and the STOP notice. Never include a price.
            </p>
          </>
        )}
      </fieldset>

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
