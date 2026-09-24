"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dollars, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, type QuoteSectionField } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { saveQuote } from "@/app/crm/quotes/[id]/actions";
import {
  OptionBuilder,
  rowsFromOptions,
  rowsMatch,
  rowsToJson,
  rowsTotal,
  type OptionRow,
  type StoredOption,
} from "@/app/crm/quotes/[id]/option-builder";
import {
  PackageBuilder,
  filledPackages,
  leadPackageAmount,
  offersChoice,
  packageAmountOf,
  packagesMatch,
  packagesToJson,
  rowsFromPackages,
  type PackageRow,
  type StoredPackage,
} from "@/app/crm/quotes/[id]/package-builder";
import type { SaveState } from "@/app/crm/quotes/[id]/types";
import { AutoTextarea } from "@/components/auto-textarea";
import { QuoteSections } from "@/components/quote-sections";

// What the Not applicable button writes. English whatever the crew's own
// language is: the customer reads this text, and the customer's page is in
// English. It used to write the crew's translation, which put "No aplica" on
// a customer's quote.
const NOT_APPLICABLE = "Not applicable";

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
  options,
  packages,
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
  // The line items on this quote, if it was written as a list of choices. An
  // empty list is the ordinary one-price quote and nothing here changes.
  options: StoredOption[];
  // The ways of doing the job on offer, if the customer asked for the same job
  // two ways. Empty on every ordinary quote.
  packages: StoredPackage[];
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
  const [preview, setPreview] = useState(false);
  const [price, setPrice] = useState(amount != null ? String(amount) : "");
  const [what, setWhat] = useState(summary ?? "");
  const [sections, setSections] = useState<Sections>(() => ({
    ...emptySections(),
    ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initialSections?.[f] ?? ""])),
  }));
  const [rows, setRows] = useState<OptionRow[]>(() => rowsFromOptions(options));
  const [pkgRows, setPkgRows] = useState<PackageRow[]>(() => rowsFromPackages(packages));
  // Resync to the server once a save lands. Without this the rows in state
  // still have no ids after the first save, and the next one would insert a
  // second copy of every line item instead of updating the ones just written.
  const optionsSig = options
    .map((o) => `${o.id}|${o.title}|${o.description ?? ""}|${o.amount}|${o.required}`)
    .join("~");
  const storedRows = useMemo(() => rowsFromOptions(options), [optionsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRows(rowsFromOptions(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsSig]);

  const packagesSig = packages
    .map((p) => `${p.id}|${p.title}|${p.description ?? ""}|${p.amount}|${p.recommended}`)
    .join("~");
  const storedPkgRows = useMemo(() => rowsFromPackages(packages), [packagesSig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPkgRows(rowsFromPackages(packages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packagesSig]);

  const setSection = (field: QuoteSectionField, value: string) =>
    setSections((s) => ({ ...s, [field]: value }));

  // Line items own the price when there are any: the box above just reports
  // their sum, so the crew can't send a total that matches nothing on the quote.
  const itemised = rows.length > 0;
  // A choice of ways to do the job. No single price on such a quote: the row
  // carries the lead option plus everything else, same as the CRM.
  const choice = offersChoice(pkgRows);
  const derived = itemised || choice;
  const derivedTotal = Math.round(((choice ? leadPackageAmount(pkgRows) : 0) + rowsTotal(rows)) * 100) / 100;
  const priceNum = derived ? derivedTotal : Number(price);
  // Every option priced, and there is more than one of them - the server
  // refuses both otherwise, and a greyed-out button beats a refusal.
  const packagesReady =
    filledPackages(pkgRows).length === 0 ||
    (choice && filledPackages(pkgRows).every((r) => packageAmountOf(r) > 0));
  const hasLegacySummary = (summary ?? "").trim().length > 0;
  // Every section filled, or an older quote that still has its free text.
  const sectionsReady = QUOTE_SECTION_FIELDS.every((f) => sections[f].trim()) || hasLegacySummary;

  // Correcting a quote the customer is still holding. What makes it a
  // correction rather than the same text again is that something they read has
  // actually changed, so the button waits for that instead of letting them
  // press Send and get the server's refusal back.
  const changed =
    (derived ? derivedTotal !== Number(amount ?? 0) : price.trim() !== (amount != null ? String(amount) : "")) ||
    !rowsMatch(storedRows, rows) ||
    !packagesMatch(storedPkgRows, pkgRows) ||
    what.trim() !== (summary ?? "").trim() ||
    QUOTE_SECTION_FIELDS.some((f) => sections[f].trim() !== (initialSections?.[f] ?? "").trim());

  // What still stands between them and Send, said in words under the button
  // rather than left as a grey button with no reason.
  const sectionsLeft = hasLegacySummary ? 0 : QUOTE_SECTION_FIELDS.filter((f) => !sections[f].trim()).length;
  const sectionsDone = QUOTE_SECTION_FIELDS.length - QUOTE_SECTION_FIELDS.filter((f) => !sections[f].trim()).length;
  const priceOk = (derived || price.trim() !== "") && Number.isFinite(priceNum) && priceNum > 0;

  const ready =
    (derived || price.trim() !== "") &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    packagesReady &&
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
  //
  // Three states, not two. A quote written at 9pm has its customer text held
  // until 8am, which is neither sent nor failed: reading it as a failure sends
  // the crew chasing the office over something that is already handled, and
  // reading it as sent would be a lie about a text nobody has yet received.
  const result =
    state.sent && !pending && !state.error ? (
      <p className={state.smsDelivered ? "js-ok" : state.smsHeldUntil ? "js-hint" : "js-err"}>
        {state.smsDelivered
          ? state.revised
            ? t.contractorJob.quoteFixOk
            : t.contractorJob.quoteOk
          : state.smsHeldUntil
            ? fill(t.contractorJob.quoteQueued, { when: state.smsHeldUntil })
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
      ? new Date(sentAt).toLocaleString("en-US", {
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
          {amount != null ? ` - ${dollars(amount)}` : ""}
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
            ? `${t.contractorJob.quoteSentAlready}${amount != null ? ` ${dollars(amount)}` : ""}`
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
        {/* The whole list as JSON - a variable number of rows can't ride on
            named form fields without an indexing scheme the server would then
            have to undo. */}
        <input type="hidden" name="options_json" value={rowsToJson(rows)} />
        <input type="hidden" name="packages_json" value={packagesToJson(pkgRows)} />

        {/* The price, set the way the customer will see it: one big number
            in the same card their quote page opens on. */}
        <label className="jq-price">
          <span className="jq-price-label">
            {derived ? t.contractorJob.quoteTotalLabel : t.contractorJob.quotePriceLabel}
          </span>
          <span className="jq-price-row">
            <span className="jq-price-sign" aria-hidden="true">$</span>
            <input
              type="number"
              name="quote_amount"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={derived ? String(derivedTotal) : price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="6500"
              readOnly={derived}
              aria-label={t.contractorJob.quoteAmount}
            />
          </span>
        </label>

        {/* The same five sections the CRM asks for, so a quote written from a
            truck covers exactly what one written at a desk does - and on the
            same timeline the customer reads them on, so the crew is filling in
            the page the customer gets rather than a form that becomes it. */}
        <div className="jq-included">
          <div className="jq-included-head">
            <h3>{t.contractorJob.quoteIncluded}</h3>
            <span className={sectionsLeft === 0 ? "jq-count jq-count-done" : "jq-count"}>
              {fill(t.contractorJob.quoteDone, { n: String(sectionsDone) })}
            </span>
          </div>
          <ol className="jq-steps">
            {QUOTE_SECTION_FIELDS.map((field) => {
              const filled = sections[field].trim() !== "";
              return (
                <li key={field} className={filled ? "jq-step jq-step-done" : "jq-step"}>
                  <div className="jq-step-head">
                    <label htmlFor={`jq-${field}`}>{t.contractorJob.sections[field]}</label>
                    {!filled && (
                      <button type="button" className="jq-na" onClick={() => setSection(field, NOT_APPLICABLE)}>
                        {t.contractorJob.notApplicable}
                      </button>
                    )}
                  </div>
                  <AutoTextarea
                    id={`jq-${field}`}
                    name={field}
                    rows={2}
                    value={sections[field]}
                    onChange={(e) => setSection(field, e.target.value)}
                    placeholder={t.contractorJob.sectionHints[field]}
                  />
                </li>
              );
            })}
          </ol>
        </div>

        {/* The extras, after the everyday path rather than in front of it:
            most quotes are one price and five sections, and these two boxes
            are a paragraph each of reading to scroll past on the way there.
            Still here for the back yard that asks "and what about the
            sidewalk?" - adding one turns the price card above into the total. */}
        <OptionBuilder rows={rows} onChange={setRows} labels={t.quoteOptions} />

        {/* And the other question the same back yard produces: "what would it
            cost in asphalt instead?" Two prices on one quote, answered here
            rather than as a second quote on a second link. */}
        <PackageBuilder rows={pkgRows} onChange={setPkgRows} labels={t.quotePackages} />

        {/* Only for a quote written before the sections existed. */}
        {hasLegacySummary && (
          <label className="jq-field">
            <span>{t.contractorJob.quoteSummary}</span>
            <AutoTextarea name="quote_summary" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
          </label>
        )}

        {/* The customer's page, built from what is in the fields right now,
            with the same component that page uses. Closed by default: the
            form above already reads like it, this is the final check. */}
        <button
          type="button"
          className="jq-preview-toggle"
          aria-expanded={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview
            ? t.contractorJob.quotePreviewClose
            : fill(t.contractorJob.quotePreviewOpen, { name: customerFirstName })}
        </button>
        {preview && (
          <div className="jq-preview">
            <p className="jq-preview-note">{fill(t.contractorJob.quotePreviewNote, { name: customerFirstName })}</p>
            <h4 className="cq-title">Hi {customerFirstName},</h4>
            <div className="cq-price">
              <span className="cq-price-label">{derived ? "Your total" : "Your price, all in"}</span>
              <span className="cq-price-value">{priceOk ? dollars(priceNum) : "-"}</span>
              <span className="cq-price-sub">Free quote · no obligation until you approve</span>
            </div>
            {sectionsDone > 0 && (
              <div className="cq-summary">
                <h2>What&apos;s included</h2>
                <QuoteSections
                  sections={QUOTE_SECTION_FIELDS.filter((f) => sections[f].trim()).map(
                    (f) => [QUOTE_SECTION_LABELS[f], sections[f]] as const,
                  )}
                />
              </div>
            )}
          </div>
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
        {!priceOk ? (
          <p className="jq-todo">{t.contractorJob.quoteNeedPrice}</p>
        ) : (
          sectionsLeft > 0 && (
            <p className="jq-todo">{fill(t.contractorJob.quoteNeedSections, { n: String(sectionsLeft) })}</p>
          )
        )}

        <button type="submit" className="js-confirm jq-send" disabled={!ready || pending}>
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
