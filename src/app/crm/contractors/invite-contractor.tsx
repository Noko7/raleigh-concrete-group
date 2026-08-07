"use client";

import { useActionState } from "react";

import { sendContractorInvite } from "./actions";
import type { InviteState } from "./types";

export function InviteContractor() {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(sendContractorInvite, { ok: false });

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Invite a contractor</h2>
      <p className="crm-muted crm-sm">
        Text a one-time link and let them fill in their own name, email and password. Nothing is created until they
        complete it, so a wrong number just expires on its own.
      </p>

      <form action={formAction} className="crm-editor">
        <div className="crm-editor-row">
          <label className="crm-field">
            <span>Their phone number</span>
            <input name="phone" type="tel" className="crm-input" placeholder="(919) 555-1234" required />
          </label>
          <label className="crm-field">
            <span>Name (optional, pre-fills their form)</span>
            <input name="full_name" className="crm-input" />
          </label>
        </div>
        <div className="crm-editor-foot">
          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? "Sending…" : "Send invite"}
          </button>
          {state.error && <span className="crm-auth-error">{state.error}</span>}
        </div>
      </form>

      {state.ok && state.link && (
        <div className="crm-tempcreds">
          <p>
            Invite created for <strong>{state.phone}</strong>.
            {state.smsSent ? " We texted them the link." : ""}
          </p>
          {/* Always show the link: the invite is valid even when the text fails,
              and this is the only place it can be recovered from. */}
          <code className="crm-code">{state.link}</code>
          <p className="crm-muted crm-sm">
            {state.smsNote ?? "It works once and expires in 7 days. Their account appears here once they finish."}
          </p>
        </div>
      )}
    </div>
  );
}
