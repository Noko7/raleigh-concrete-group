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
            <span>Phone (optional)</span>
            <input name="phone" type="tel" className="crm-input" />
          </label>
        </div>
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
            Account created for <strong>{state.email}</strong>. Share this temporary password with them (shown once):
          </p>
          <code className="crm-code">{state.password}</code>
          <p className="crm-muted crm-sm">They sign in at this CRM and should change it from Supabase if needed.</p>
        </div>
      )}
    </div>
  );
}
