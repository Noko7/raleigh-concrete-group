import { clockLabel } from "@/lib/crm/clock";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { QUOTE_TEXT_KINDS } from "@/lib/crm/messages";
import { isCancellable, isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { CancelHeldText } from "@/app/crm/quotes/[id]/cancel-held-text";
import { SendHeldNow } from "@/app/crm/quotes/[id]/send-held-now";

// Held texts only, so the person who pressed Send can see whether it's still waiting, and send it now or
// stop it. Not a second message log.
export function JobHeldTexts({
  quoteId,
  messages,
  quiet,
  isOwner,
  locale,
}: {
  quoteId: string;
  messages: QuoteMessage[];
  quiet: boolean;
  isOwner: boolean;
  locale: Locale;
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
            {m.body && <p className="jh-body">{m.body}</p>}
            <SendHeldNow quoteId={quoteId} messageId={m.id} quiet={quiet} locale={locale} />
            {/* Same rule as the CRM log: hidden once due, when a cancel would race the send. */}
            {isCancellable(m) && (
              <CancelHeldText quoteId={quoteId} messageId={m.id} isQuote={QUOTE_TEXT_KINDS.has(m.kind)} isOwner={isOwner} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
