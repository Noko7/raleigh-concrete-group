"use client";

import { dollars } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";

// The event JobQuote listens for: open its edit form and scroll to it.
export const EDIT_QUOTE_EVENT = "rcg:edit-quote";

// A sent quote waiting on the customer, near the top of the crew's job page: the way in to editing it. The quote
// card itself stays in one place at the bottom, so it is never remounted and keeps its send result on screen.
export function QuoteEditShortcut({ locale, customerFirstName, amount }: { locale: Locale; customerFirstName: string; amount: number | null }) {
  const t = dict(locale);
  return (
    <section className="js-card jq-card jq-waiting">
      <h2 className="js-title">{t.contractorJob.quoteWaitingTitle}</h2>
      <p className="js-lead">
        {fill(t.contractorJob.quoteWaitingLead, { name: customerFirstName })}
        {amount != null ? ` - ${dollars(amount)}` : ""}
      </p>
      <button type="button" className="js-confirm jq-fix-open" onClick={() => window.dispatchEvent(new Event(EDIT_QUOTE_EVENT))}>
        {t.contractorJob.quoteFixOpen}
      </button>
    </section>
  );
}
