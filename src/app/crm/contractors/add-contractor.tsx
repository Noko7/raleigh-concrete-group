"use client";

import { useActionState } from "react";

import { createContractor } from "./actions";
import type { AddState } from "./types";

export function AddContractor() {
  const [state, formAction, pending] = useActionState<AddState, FormData>(createContractor, { ok: false });

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Add a contractor</h2>
      <form action={formAction} className="crm-editor">
        <div className="crm-editor-row">
          <label className="crm-field">
            <span>Full name</span>
            <input name="full_name" className="crm-input" required />
          </label>
          <label className="crm-field">
            <span>Email</span>
            <input name="email" type="email" className="crm-input" required />
          </label>
          <label className="crm-field">
            <span>Phone (for texting their login)</span>
            <input name="phone" type="tel" className="crm-input" />
          </label>
        </div>
        <label className="crm-check">
          <input type="checkbox" name="notify" defaultChecked />
          <span>Text the contractor their login and temporary password</span>
        </label>
        <div className="crm-editor-foot">
          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? "Creating…" : "Create contractor"}
          </button>
          {state.error && <span className="crm-auth-error">{state.error}</span>}
        </div>
      </form>

      {state.ok && state.password && (
        <div className="crm-tempcreds">
          <p>
            Account created for <strong>{state.email}</strong>.
            {state.smsSent ? " We texted them their login and temporary password." : " Share this temporary password (shown once):"}
          </p>
          <code className="crm-code">{state.password}</code>
          <p className="crm-muted crm-sm">
            {state.smsNote
              ? state.smsNote
              : "They'll be asked to set their own password the first time they sign in."}
          </p>
        </div>
      )}
    </div>
  );
}
