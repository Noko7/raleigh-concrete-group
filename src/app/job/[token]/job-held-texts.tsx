import { clockLabel } from "@/lib/crm/clock";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { SendHeldNow } from "@/app/crm/quotes/[id]/send-held-now";

// Held texts only, so the person who pressed Send can see whether it's still waiting and send it now.
// Not a second message log.
export function JobHeldTexts({
  quoteId,
  messages,
  quiet,
  locale,
}: {
  quoteId: string;
  messages: QuoteMessage[];
  quiet: boolean;
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
          </li>
        ))}
      </ul>
    </section>
  );
}
