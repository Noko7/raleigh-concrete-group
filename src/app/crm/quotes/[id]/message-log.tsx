import { BUSINESS_TZ, clockLabel, inQuietHours } from "@/lib/crm/clock";
import { messageLabel, roleLabel } from "@/lib/crm/messages";
import { isCancellable, isCancelled, isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { CancelHeldText } from "./cancel-held-text";
import { SendHeldNow } from "./send-held-now";

// Keep in step with QUOTE_TEXT_KINDS in send-actions.ts, which decides what actually happens.
const QUOTE_KINDS = new Set(["quote_ready", "quote_updated"]);

// Every text this job produced and whether it left. Sends are best-effort (an outage must never fail a
// quote), so this is the trace, kept on the job. <details> instead of a modal so it works without client
// JS; failures show the provider's own words.
// Raleigh time, matching the phone in your hand.
function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TZ });
}

export function MessageLog({ messages, isOwner }: { messages: QuoteMessage[]; isOwner: boolean }) {
  // Whether a manual send now means texting someone at 6am. One clock for the whole list.
  const quiet = inQuietHours();
  // A held text is neither sent nor failed. Quiet hours only hold CUSTOMER texts; anything else queued was
  // spread out by a cron run. Same badge, different sentence.
  const held = messages.filter(isHeld);
  const heldForMorning = held.filter((m) => m.role === "customer");
  const spaced = held.length - heldForMorning.length;
  // Cancelled is not failed: someone decided it shouldn't go.
  const failed = messages.filter((m) => !m.ok && !isHeld(m) && !isCancelled(m)).length;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Texts sent</h2>

      {messages.length === 0 ? (
        <p className="crm-muted crm-sm">
          No texts recorded for this job yet.
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

                {/* Holds and cancellations explain themselves in the badge; this line is for real provider failures. */}
                {m.detail && !m.ok && !isHeld(m) && !isCancelled(m) && <pre className="msg-detail">{m.detail}</pre>}

                {/*
                  On the row, not a menu: the queued-to-sent window is short.
                  Send shows on ANY held row (past its hour too, e.g. a stalled queue): losing the race just reports it
                  was claimed. Cancel hides once the hour arrives: a cancel landing just after a send would mark a
                  delivered text cancelled.
                */}
                {isHeld(m) && m.quote_id && <SendHeldNow quoteId={m.quote_id} messageId={m.id} quiet={quiet} />}

                {isCancellable(m) && m.quote_id && (
                  <CancelHeldText
                    quoteId={m.quote_id}
                    messageId={m.id}
                    isQuote={QUOTE_KINDS.has(m.kind)}
                    isOwner={isOwner}
                  />
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
