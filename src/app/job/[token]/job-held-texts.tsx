import { clockLabel } from "@/lib/crm/clock";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { isCancellable, isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { CancelHeldText } from "@/app/crm/quotes/[id]/cancel-held-text";
import { EditHeldText } from "@/app/crm/quotes/[id]/edit-held-text";
import { SendHeldNow } from "@/app/crm/quotes/[id]/send-held-now";

// The texts that carry the quote itself. Kept in step with QUOTE_TEXT_KINDS in
// the job page's actions: cancelling one of these retracts the quote.
const QUOTE_KINDS = new Set(["quote_ready", "quote_updated"]);

// The crew's view of anything this job has written but not yet sent.
//
// The office has had this on the CRM job page for a while; the crew had no
// equivalent, which meant the person who actually pressed Send was the one
// person who could not see what had become of it. They were told "scheduled for
// 8:00 AM" once, in a toast, and after that the job page looked identical
// whether the text was queued, sent, or quietly lost.
//
// Only held rows appear. This is not a second message log - the crew do not
// need a transcript of every text the office has ever sent this customer. It is
// one question, answered when the answer is "not yet": is anything still
// waiting, and do you want it to go now?
export function JobHeldTexts({
  quoteId,
  messages,
  quiet,
  locale,
  isOwner,
}: {
  quoteId: string;
  messages: QuoteMessage[];
  quiet: boolean;
  locale: Locale;
  isOwner: boolean;
}) {
  const held = messages.filter(isHeld);
  if (held.length === 0) return null;

  const t = dict(locale).heldText;

  return (
    <section className="js-card jh-card">
      <h2 className="js-title">{t.title}</h2>
      <p className="js-lead">{t.lead}</p>

      <ul className="jh-list">
        {held.map((m) => (
          <li key={m.id}>
            <span className="crm-badge crm-badge-warning">
              {fill(m.role === "customer" ? t.waitingUntil : t.queuedFor, {
                when: clockLabel(new Date(m.send_after as string)),
              })}
            </span>
            {/* Changed or stopped before it goes: a confirmed visit whose time
                was wrong, or a text that no longer needs sending. Both only
                while it is safely in the queue (isCancellable). */}
            {m.body && (
              <EditHeldText
                quoteId={quoteId}
                messageId={m.id}
                body={m.body}
                canEdit={isCancellable(m) && (isOwner || !QUOTE_KINDS.has(m.kind))}
              />
            )}
            <SendHeldNow quoteId={quoteId} messageId={m.id} quiet={quiet} locale={locale} />
            {isCancellable(m) && (
              <CancelHeldText quoteId={quoteId} messageId={m.id} isQuote={QUOTE_KINDS.has(m.kind)} isOwner={isOwner} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
