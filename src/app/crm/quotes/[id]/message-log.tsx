import { messageLabel, roleLabel } from "@/lib/crm/messages";
import type { QuoteMessage } from "@/lib/crm/queries";

// Every text this job has produced, and whether it left the building.
//
// Sends are deliberately best-effort - a texting outage must never fail a
// customer's quote submission - but that used to mean a lead could arrive with
// nobody notified and no trace of why. This is the trace, and it lives on the
// job rather than in a log file, because "did the customer actually get that?"
// is a question you ask while looking at the customer.
//
// Bodies are in <details> rather than a modal so the whole thing works without
// client JavaScript, and a failed send shows the provider's own words: "Failed"
// on its own is the same dead end as the generic errors this replaced.
function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function MessageLog({ messages }: { messages: QuoteMessage[] }) {
  const failed = messages.filter((m) => !m.ok).length;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Texts sent</h2>

      {messages.length === 0 ? (
        <p className="crm-muted crm-sm">
          No texts recorded for this job yet. If you were expecting some, check that{" "}
          <code>supabase/message-log.sql</code> has been run — until it has, sends still go out but nothing is
          recorded here.
        </p>
      ) : (
        <>
          <p className="crm-muted crm-sm">
            {failed > 0
              ? `${failed} of ${messages.length} did not send. "Accepted" means your provider took it; carrier delivery is a separate step we aren't told about.`
              : `${messages.length} sent. "Accepted" means your provider took it; carrier delivery is a separate step we aren't told about.`}
          </p>

          <ul className="msg-log">
            {messages.map((m) => (
              <li key={m.id} className={m.ok ? "" : "msg-bad"}>
                <div className="msg-head">
                  <span className={`crm-badge ${m.ok ? "crm-badge-success" : "crm-badge-danger"}`}>
                    {m.ok ? "Accepted" : "Failed"}
                  </span>
                  <strong className="msg-kind">{messageLabel(m.kind)}</strong>
                  <span className="crm-muted crm-sm msg-to">
                    {roleLabel(m.role)}
                    {m.to_phone ? ` · ${m.to_phone}` : ""}
                  </span>
                  <span className="crm-muted crm-sm msg-when">{fmt(m.created_at)}</span>
                </div>

                {m.detail && !m.ok && <pre className="msg-detail">{m.detail}</pre>}

                {m.body && (
                  <details className="msg-body">
                    <summary>What we sent</summary>
                    <pre>{m.body}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
