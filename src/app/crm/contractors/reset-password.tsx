"use client";

import { useActionState, useState } from "react";

import { resetContractorPassword } from "./actions";
import type { ResetState } from "./types";

export function ResetPassword({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(resetContractorPassword, { ok: false });
  const [confirming, setConfirming] = useState(false);

  if (state.ok && state.password) {
    return (
      <div className="crm-tempcreds">
        <p>
          New temporary password for <strong>{name}</strong>
          {state.smsSent ? " - we texted it to them." : " (shown once):"}
        </p>
        <code className="crm-code">{state.password}</code>
        <p className="crm-muted crm-sm">
          {state.smsNote ?? "They'll set their own password the next time they sign in."}
        </p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(true)}>
        Reset password
      </button>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <p className="crm-sm">Reset {name}&apos;s password?</p>
      <label className="crm-check">
        <input type="checkbox" name="notify" defaultChecked />
        <span>Text them the new password</span>
      </label>
      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
        {pending ? "Resetting…" : "Confirm reset"}
      </button>
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </button>
      {state.error && <span className="crm-auth-error">{state.error}</span>}
    </form>
  );
}
