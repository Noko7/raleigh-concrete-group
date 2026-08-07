"use client";

import { useActionState } from "react";

import { sendTestSms } from "./actions";
import type { TestSmsState } from "./types";

export function TestSms({
  provider,
  from,
  missing,
  ready,
  recipients,
}: {
  provider: string;
  from: string | null;
  missing: string[];
  ready: boolean;
  recipients: string[];
}) {
  const [state, formAction, pending] = useActionState<TestSmsState, FormData>(sendTestSms, { ok: false });

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Text notifications</h2>
      <p className="crm-muted crm-sm">
        Send one real text through your provider to prove alerts work. If it fails you&apos;ll see the provider&apos;s
        own error here, which is what tells you whether it&apos;s the API key, the sending number, or carrier
        registration.
      </p>

      <dl className="crm-dl sms-diag">
        <div>
          <dt>Provider</dt>
          <dd>{provider}</dd>
        </div>
        <div>
          <dt>Sending from</dt>
          <dd>{from || <span className="crm-muted">Not set</span>}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>
            {ready ? (
              <span className="crm-badge crm-badge-success">Complete</span>
            ) : (
              <>
                <span className="crm-badge crm-badge-danger">Incomplete</span>{" "}
                <span className="crm-sm">missing {missing.join(", ")}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Owner alerts go to</dt>
          <dd>
            {recipients.length > 0 ? (
              recipients.join(", ")
            ) : (
              <span className="crm-muted">Nobody — save your phone above or set OWNER_PHONE</span>
            )}
          </dd>
        </div>
      </dl>

      <form action={formAction} className="crm-editor">
        <label className="crm-field">
          <span>Send to (leave blank to text every owner number)</span>
          <input name="to" className="crm-input" placeholder="(919) 555-1234" />
        </label>
        <div className="crm-editor-foot">
          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? "Sending…" : "Send test text"}
          </button>
          {state.error && <span className="crm-auth-error">{state.error}</span>}
        </div>
      </form>

      {state.results && state.results.length > 0 && (
        <ul className="sms-results">
          {state.results.map((r) => (
            <li key={r.to} className={r.ok ? "sms-result-ok" : "sms-result-bad"}>
              <div className="sms-result-head">
                <strong>{r.to}</strong>
                <span className={`crm-badge ${r.ok ? "crm-badge-success" : "crm-badge-danger"}`}>
                  {r.ok ? "Accepted" : "Failed"}
                </span>
                {r.status != null && <span className="crm-muted crm-sm">HTTP {r.status}</span>}
              </div>
              {r.detail && <pre className="sms-detail">{r.detail}</pre>}
              {r.ok && (
                <p className="crm-muted crm-sm">
                  Your provider accepted it. If the text never arrives, the hold-up is carrier delivery rather than
                  this app.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
