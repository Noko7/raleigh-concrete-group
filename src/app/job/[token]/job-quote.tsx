"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { saveQuote } from "@/app/crm/quotes/[id]/actions";
import type { SaveState } from "@/app/crm/quotes/[id]/types";

// Quoting from the crew's own job page. Same server action as the CRM, so the
// validation, the customer text and the activity log are identical - this is a
// phone-shaped surface onto it, not a second implementation.
//
// Collapsed by default: most visits to this page are about the schedule, and an
// open price form would push the day-confirming buttons off the screen.
export function JobQuote({
  id,
  locale,
  amount,
  summary,
  alreadySent,
  awaitingReply,
  sentAt,
  customerFirstName,
}: {
  id: string;
  locale: Locale;
  amount: number | null;
  summary: string | null;
  alreadySent: boolean;
  awaitingReply: boolean;
  sentAt: string | null;
  customerFirstName: string;
}) {
  const t = dict(locale);
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(amount != null ? String(amount) : "");
  const [what, setWhat] = useState(summary ?? "");

  const priceNum = Number(price);
  const ready = price.trim() !== "" && Number.isFinite(priceNum) && priceNum > 0 && what.trim().length > 0;

  // Pull fresh server data once the send lands, so the status and the activity
  // log on this page match what just happened.
  useEffect(() => {
    if (state.ok || state.sent) router.refresh();
  }, [state, router]);

  // The ball is in the customer's court, so there is no button here at all.
  // Leaving a "Resend" that always refuses would just move the frustration from
  // the customer's phone to this page; showing when it went and what it said
  // answers the question that makes people press Send again in the first place.
  if (awaitingReply) {
    const when = sentAt
      ? new Date(sentAt).toLocaleString(locale === "es" ? "es-US" : "en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;
    return (
      <section className="js-card jq-card jq-waiting">
        <h2 className="js-title">{t.contractorJob.quoteWaitingTitle}</h2>
        <p className="js-lead">
          {fill(t.contractorJob.quoteWaitingLead, { name: customerFirstName })}
          {amount != null ? ` — $${amount.toLocaleString("en-US")}` : ""}
        </p>
        {when && <p className="js-hint">{fill(t.contractorJob.quoteWaitingSent, { when })}</p>}
        <p className="js-hint">{t.contractorJob.quoteWaitingHint}</p>
      </section>
    );
  }

  if (!open) {
    return (
      <section className="js-card jq-card">
        <h2 className="js-title">{alreadySent ? t.contractorJob.quoteResend : t.contractorJob.quoteTitle}</h2>
        <p className="js-lead">
          {alreadySent
            ? `${t.contractorJob.quoteSentAlready}${amount != null ? ` $${amount.toLocaleString("en-US")}` : ""}`
            : t.contractorJob.quoteLead}
        </p>
        <button type="button" className="js-confirm" onClick={() => setOpen(true)}>
          {alreadySent ? t.contractorJob.quoteResend : t.contractorJob.quoteOpen}
        </button>
      </section>
    );
  }

  return (
    <section className="js-card jq-card">
      <h2 className="js-title">{t.contractorJob.quoteTitle}</h2>
      <p className="js-lead">{t.contractorJob.quoteLead}</p>

      <form action={formAction} className="jq-form">
        <input type="hidden" name="id" value={id} />
        {/* Same pattern as the CRM editor: intent rides on a hidden field, not
            on the submit button, so it can't silently fall through to "save"
            and report success without texting anyone. */}
        <input type="hidden" name="intent" value="send" />

        <label className="jq-field">
          <span>{t.contractorJob.quoteAmount}</span>
          <input
            type="number"
            name="quote_amount"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="6500"
          />
        </label>

        <label className="jq-field">
          <span>{t.contractorJob.quoteSummary}</span>
          <textarea
            name="quote_summary"
            rows={4}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={t.contractorJob.quotePlaceholder}
          />
        </label>

        <p className="js-hint">{t.contractorJob.quoteWho.replace("{name}", customerFirstName)}</p>

        <button type="submit" className="js-confirm" disabled={!ready || pending}>
          {pending ? t.contractorJob.quoteSending : t.contractorJob.quoteSend}
        </button>
        <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending}>
          {t.common.cancel}
        </button>
      </form>

      {/* A refused duplicate isn't an error - nothing broke and there's nothing
          to fix, so it reads as a note rather than in red. */}
      {state.error && !pending && <p className={state.alreadySent ? "js-hint" : "js-err"}>{state.error}</p>}
      {state.sent && !pending && !state.error && (
        <p className={state.smsDelivered ? "js-ok" : "js-err"}>
          {state.smsDelivered ? t.contractorJob.quoteOk : t.contractorJob.quoteFailed}
        </p>
      )}
    </section>
  );
}
