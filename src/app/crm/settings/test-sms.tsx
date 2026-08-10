"use client";

import { useActionState } from "react";

import type { OwnerRecipient } from "@/lib/crm/notify";
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
  recipients: OwnerRecipient[];
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
            {recipients.length === 0 ? (
              <span className="crm-muted">Nobody — save your phone above or set OWNER_PHONE</span>
            ) : (
              <ul className="sms-targets">
                {recipients.map((r) => (
                  <li key={r.phone} className={r.active ? "" : "sms-target-off"}>
                    <strong>{r.phone}</strong>
                    <span className="crm-muted crm-sm">{r.who}</span>
                    {!r.active && <span className="sms-off-tag">not used</span>}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      {/* Every one of these numbers gets texted on every money moment, so an
          unrecognised one is worth chasing down. Naming the source isn't enough
          on its own: someone looking at a wrong number needs to be told which
          of the two places to go and fix it, or they edit the env var in Vercel
          and watch the texts keep arriving at the profile number that outranks
          it. Each line below answers "so where do I change it". */}
      {recipients.length > 0 && (
        <p className="crm-muted crm-sm sms-envnote">
          {recipients.some((r) => r.source === "profile") && (
            <>
              A number shown with a person&apos;s name is saved on that owner&apos;s profile. Change it in the{" "}
              <strong>Phone</strong> field at the top of this page (or on their staff record), then save — it takes
              effect immediately, no redeploy.{" "}
            </>
          )}
          {recipients.some((r) => r.source === "env") && (
            <>
              A number listed as <code>OWNER_PHONE env var</code> comes from Vercel, not from this app, and is only
              used while no owner has a number saved — which is why it can show as <em>not used</em>. Change it in
              Vercel → Settings → Environment Variables and redeploy.
            </>
          )}
        </p>
      )}

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
                {r.from && <span className="crm-muted crm-sm">from {r.from}</span>}
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
