import { clockLabel } from "@/lib/crm/clock";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { isHeld, type QuoteMessage } from "@/lib/crm/queries";

import { SendHeldNow } from "@/app/crm/quotes/[id]/send-held-now";

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
