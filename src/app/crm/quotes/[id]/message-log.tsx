import { BUSINESS_TZ, clockLabel } from "@/lib/crm/clock";
import { messageLabel, roleLabel } from "@/lib/crm/messages";
import { isCancelled, isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { cancelHeldMessage } from "./actions";

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
// Raleigh time, not the server's. These rows are read next to a phone that
// says something different, and a log that disagrees with the phone in your
// hand is a log you stop trusting.
function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
}

export function MessageLog({ messages }: { messages: QuoteMessage[] }) {
  // A text waiting for 8am is neither sent nor failed, and counting it as
  // failed would put a red number on a night that went fine.
  //
  // Two different reasons a row is waiting, and the role is what separates
  // them: quiet hours only ever holds a CUSTOMER text, so anything else in the
  // queue is there because a cron run spread its texts out. Same badge, because
  // both mean "this is going to send"; different sentence, because only one of
  // them is a rule about the hour.
  const held = messages.filter(isHeld);
  const heldForMorning = held.filter((m) => m.role === "customer");
  const spaced = held.length - heldForMorning.length;
  // A cancelled text is not a failed one. It never left because somebody
  // decided it shouldn't, which is the queue working, not the queue breaking.
  const failed = messages.filter((m) => !m.ok && !isHeld(m) && !isCancelled(m)).length;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Texts sent</h2>

      {messages.length === 0 ? (
        <p className="crm-muted crm-sm">
          No texts recorded for this job yet. If you were expecting some, check that{" "}
          <code>supabase/message-log.sql</code> has been run - until it has, sends still go out but nothing is
          recorded here.
        </p>
      ) : (
        <>
          <p className="crm-muted crm-sm">
            {failed > 0
              ? `${failed} of ${messages.length} did not send. "Accepted" means your provider took it; carrier delivery is a separate step we aren't told about.`
              : `${messages.length} sent. "Accepted" means your provider took it; carrier delivery is a separate step we aren't told about.`}
            {heldForMorning.length > 0 &&
              ` ${heldForMorning.length} ${heldForMorning.length === 1 ? "text is" : "texts are"} waiting for the morning: nothing goes out to a customer between 7pm and 8am.`}
            {spaced > 0 &&
              ` ${spaced} ${spaced === 1 ? "text is" : "texts are"} queued a few minutes apart, so the crew get them one at a time rather than all at once.`}
          </p>

          <ul className="msg-log">
            {messages.map((m) => (
              <li key={m.id} className={m.ok || isHeld(m) || isCancelled(m) ? "" : "msg-bad"}>
                <div className="msg-head">
                  <span
                    className={`crm-badge ${
                      m.ok
                        ? "crm-badge-success"
                        : isHeld(m)
                          ? "crm-badge-warning"
                          : isCancelled(m)
                            ? "crm-badge-lost"
                            : "crm-badge-danger"
                    }`}
                  >
                    {m.ok
                      ? "Accepted"
                      : isHeld(m)
                        ? `${m.role === "customer" ? "Waiting until" : "Queued for"} ${clockLabel(new Date(m.send_after!))}`
                        : isCancelled(m)
                          ? "Cancelled"
                          : "Failed"}
                  </span>
                  <strong className="msg-kind">{messageLabel(m.kind)}</strong>
                  <span className="crm-muted crm-sm msg-to">
                    {roleLabel(m.role)}
                    {m.to_phone ? ` · ${m.to_phone}` : ""}
                  </span>
                  <span className="crm-muted crm-sm msg-when">{fmt(m.created_at)}</span>
                </div>

                {/* A hold and a cancellation both explain themselves in the
                    badge; the detail line is for a provider's own words about a
                    real failure. */}
                {m.detail && !m.ok && !isHeld(m) && !isCancelled(m) && <pre className="msg-detail">{m.detail}</pre>}

                {/* The window between "queued" and "sent" is the only chance
                    anyone gets to take a text back, so the button lives on the
                    row rather than behind a menu. A plain form, like the rest
                    of this page: the log re-renders and the badge is the
                    receipt. If the queue sent it in the meantime the row comes
                    back "Accepted" and the button is gone, which is the truth. */}
                {isHeld(m) && (
                  <form action={cancelHeldMessage} className="msg-cancel">
                    <input type="hidden" name="id" value={m.quote_id ?? ""} />
                    <input type="hidden" name="messageId" value={m.id} />
                    <button type="submit" className="crm-btn crm-btn-ghost msg-cancel-btn">
                      Cancel this text
                    </button>
                    <span className="crm-muted crm-sm">It hasn&apos;t gone out yet - this stops it for good.</span>
                  </form>
                )}


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
