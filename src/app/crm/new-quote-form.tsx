"use client";

import { useActionState, useEffect, useState } from "react";

import { todayYmd } from "@/lib/crm/clock";
import { quoteServiceOptions } from "@/lib/site-data";
import { createQuote, type NewQuoteState } from "./new-quote-actions";
import { AutoTextarea } from "@/components/auto-textarea";

type ContractorOption = { id: string; label: string };

export function NewQuoteForm({ contractors }: { contractors: ContractorOption[] }) {
  const [state, formAction, pending] = useActionState<NewQuoteState, FormData>(createQuote, { ok: false });
  const [open, setOpen] = useState(false);
  const [quoteType, setQuoteType] = useState("");
  const [sendText, setSendText] = useState(false);
  // The lead-time floor applies to website requests, not what the office agrees on a call.
  const today = todayYmd();

  // Collapse once saved (the lead appears via revalidatePath) so the open form doesn't invite a duplicate.
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
          {/* Same list as the public form: this routes the lead, and a typed value wouldn't match the rules. */}
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

      {/* Auto matches a web lead; the override is for jobs that belong to a specific person regardless of rules. */}
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

      {/* In-person only: the only kind where someone drives out. */}
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
        <AutoTextarea name="details" className="crm-input" rows={2} placeholder="Whatever they told you on the phone" />
      </label>

      {/* Off by default: you just spoke to them. For when something promised on the call should be in writing. */}
      <fieldset className="crm-sections">
        <legend>
          <label className="svc-check">
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            <span>Text the customer now</span>
          </label>
        </legend>
        {sendText && (
          <>
            <AutoTextarea
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
