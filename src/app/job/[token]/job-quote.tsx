"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { QUOTE_SECTION_FIELDS, type QuoteSectionField } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { saveQuote } from "@/app/crm/quotes/[id]/actions";
import type { SaveState } from "@/app/crm/quotes/[id]/types";

type Sections = Record<QuoteSectionField, string>;
const emptySections = (): Sections =>
  Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, ""])) as Sections;

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
  initialSections,
  alreadySent,
  awaitingReply,
  sentAt,
  customerFirstName,
}: {
  id: string;
  locale: Locale;
  amount: number | null;
  summary: string | null;
  initialSections?: Partial<Record<QuoteSectionField, string | null>>;
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
  const [sections, setSections] = useState<Sections>(() => ({
    ...emptySections(),
    ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initialSections?.[f] ?? ""])),
  }));

  const setSection = (field: QuoteSectionField, value: string) =>
    setSections((s) => ({ ...s, [field]: value }));

  const priceNum = Number(price);
  const hasLegacySummary = (summary ?? "").trim().length > 0;
  // Every section filled, or an older quote that still has its free text.
  const sectionsReady = QUOTE_SECTION_FIELDS.every((f) => sections[f].trim()) || hasLegacySummary;

  // Correcting a quote the customer is still holding. What makes it a
  // correction rather than the same text again is that something they read has
  // actually changed, so the button waits for that instead of letting them
  // press Send and get the server's refusal back.
  const changed =
    price.trim() !== (amount != null ? String(amount) : "") ||
    what.trim() !== (summary ?? "").trim() ||
    QUOTE_SECTION_FIELDS.some((f) => sections[f].trim() !== (initialSections?.[f] ?? "").trim());

  const ready =
    price.trim() !== "" &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    sectionsReady &&
    (!awaitingReply || changed);

  // Pull fresh server data once the send lands, so the status and the activity
  // log on this page match what just happened.
  useEffect(() => {
    if (state.ok || state.sent) router.refresh();
    // A send that went through folds the form away, so the page settles back to
    // "waiting on the customer" with the result on it. A refusal leaves it open
    // with everything they typed still in the fields.
    if (state.sent && !state.error) setOpen(false);
  }, [state, router]);

  // How the last send went. Declared once and rendered in all three states,
  // because a send folds the form away and the answer has to follow it there
  // rather than disappearing with the fields.
  const result =
    state.sent && !pending && !state.error ? (
      <p className={state.smsDelivered ? "js-ok" : "js-err"}>
        {state.smsDelivered
          ? state.revised
            ? t.contractorJob.quoteFixOk
            : t.contractorJob.quoteOk
          : t.contractorJob.quoteFailed}
      </p>
    ) : null;

  // The ball is in the customer's court, so there is no Send button here.
  // Repeating a quote they already have moves the frustration from their phone
  // to this page and back; showing when it went and what it said answers the
  // question that makes people press Send again in the first place.
  //
  // Correcting it is the exception, and the only one. A price that was typed
  // wrong is sitting on a customer's phone waiting to be approved, and the crew
  // who wrote it are the ones who can see that - so they get a way to fix it
  // here rather than a phone call to the office while the wrong number stands.
  // It's a quiet second action, not a second Send: the default answer to
  // "nothing has happened yet" is still to wait.
  if (awaitingReply && !open) {
    const when = sentAt
      ? new Date(sentAt).toLocaleString(locale === "es" ? "es-US" : "en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: BUSINESS_TZ,
        })
      : null;
    return (
      <section className="js-card jq-card jq-waiting">
        <h2 className="js-title">{t.contractorJob.quoteWaitingTitle}</h2>
        <p className="js-lead">
          {fill(t.contractorJob.quoteWaitingLead, { name: customerFirstName })}
          {amount != null ? ` - $${amount.toLocaleString("en-US")}` : ""}
        </p>
        {when && <p className="js-hint">{fill(t.contractorJob.quoteWaitingSent, { when })}</p>}
        <p className="js-hint">{t.contractorJob.quoteWaitingHint}</p>
        <button type="button" className="jq-cancel jq-fix-open" onClick={() => setOpen(true)}>
          {t.contractorJob.quoteFixOpen}
        </button>
        {result}
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
        {result}
      </section>
    );
  }

  return (
    <section className="js-card jq-card">
      <h2 className="js-title">{awaitingReply ? t.contractorJob.quoteFixTitle : t.contractorJob.quoteTitle}</h2>
      <p className="js-lead">
        {awaitingReply ? fill(t.contractorJob.quoteFixLead, { name: customerFirstName }) : t.contractorJob.quoteLead}
      </p>

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

        {/* The same five sections the CRM asks for, so a quote written from a
            truck covers exactly what one written at a desk does. */}
        <p className="js-hint jq-sections-hint">{t.contractorJob.quoteSectionsHint}</p>
        {QUOTE_SECTION_FIELDS.map((field) => (
          <label key={field} className="jq-field">
            <span>
              {t.contractorJob.sections[field]}
              {!sections[field].trim() && (
                <button type="button" className="crm-na-btn" onClick={() => setSection(field, t.contractorJob.notApplicable)}>
                  {t.contractorJob.notApplicable}
                </button>
              )}
            </span>
            <textarea
              name={field}
              rows={2}
              value={sections[field]}
              onChange={(e) => setSection(field, e.target.value)}
              placeholder={t.contractorJob.sectionHints[field]}
            />
          </label>
        ))}

        {/* Only for a quote written before the sections existed. */}
        {hasLegacySummary && (
          <label className="jq-field">
            <span>{t.contractorJob.quoteSummary}</span>
            <textarea name="quote_summary" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
          </label>
        )}

        <p className="js-hint">
          {awaitingReply
            ? fill(t.contractorJob.quoteFixWho, { name: customerFirstName })
            : t.contractorJob.quoteWho.replace("{name}", customerFirstName)}
        </p>

        {/* Says why the button is greyed out before they go looking for the
            reason: a correction that changes nothing is the duplicate text the
            whole rule exists to stop. */}
        {awaitingReply && !changed && <p className="js-hint">{t.contractorJob.quoteFixUnchanged}</p>}

        <button type="submit" className="js-confirm" disabled={!ready || pending}>
          {pending
            ? t.contractorJob.quoteSending
            : awaitingReply
              ? t.contractorJob.quoteFixSend
              : t.contractorJob.quoteSend}
        </button>
        <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending}>
          {t.common.cancel}
        </button>
      </form>

      {/* A refused duplicate isn't an error - nothing broke and there's nothing
          to fix, so it reads as a note rather than in red. */}
      {state.error && !pending && <p className={state.alreadySent ? "js-hint" : "js-err"}>{state.error}</p>}
      {result}
    </section>
  );
}
