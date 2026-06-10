"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { setNewPassword } from "./reset/actions";
import type { ResetState } from "./reset/types";

export function ForceReset() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ResetState, FormData>(setNewPassword, { ok: false });

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <main className="crm-page crm-page-narrow">
      <div className="crm-card">
        <h1 className="crm-card-title">Set your password</h1>
        <p className="crm-muted crm-sm" style={{ marginBottom: "1rem" }}>
          Welcome aboard. For security, pick a new password before you start using the CRM.
        </p>
        <form action={formAction} className="crm-editor">
          <label className="crm-field">
            <span>New password</span>
            <input name="password" type="password" className="crm-input" autoComplete="new-password" minLength={8} required />
          </label>
          <label className="crm-field">
            <span>Confirm password</span>
            <input name="confirm" type="password" className="crm-input" autoComplete="new-password" minLength={8} required />
          </label>
          <div className="crm-editor-foot">
            <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save password"}
            </button>
            {state.error && <span className="crm-auth-error">{state.error}</span>}
          </div>
        </form>
      </div>
    </main>
  );
}
