"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dollars, QUOTE_SECTION_FIELDS, type QuoteSectionField } from "@/lib/crm/constants";
import { dict, tr, fill, intlLocale, type Locale } from "@/lib/crm/i18n";
import { saveQuote } from "@/app/crm/quotes/[id]/save-actions";
import {
  MoreWaysToPrice,
  OptionBuilder,
  previewOf,
  rowsFromOptions,
  rowsMatch,
  rowsToJson,
  rowsTotal,
  type OptionRow,
  type StoredOption,
} from "@/app/crm/quotes/[id]/option-builder";
import {
  PackageBuilder,
  packagesFromOptionRows,
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
import { EnglishReview, type EnglishField } from "@/components/english-review";
import { SpellTextarea } from "@/components/spell-field";
import { markEnglish, toCustomerEnglish } from "@/lib/crm/translate-client";
import type { TranslateField } from "@/lib/crm/translate-fields";
import {
  blankSections,
  CustomerPreview,
  emptySections,
  PickOneSuggestion,
  PriceCard,
  SectionsEditor,
  type Sections,
} from "@/components/quote-form-parts";

// Same server action as the CRM, so validation, customer text and log are identical.
// Collapsed by default: an open price form would push the day-confirming buttons off screen.
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
  // Empty = an ordinary one-price quote.
  options: StoredOption[];
  // Empty on every ordinary quote.
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
  const [price, setPrice] = useState(amount != null ? String(amount) : "");
  const [what, setWhat] = useState(summary ?? "");
  const [sections, setSections] = useState<Sections>(() => ({
    ...emptySections(),
    ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initialSections?.[f] ?? ""])),
  }));
  const [rows, setRows] = useState<OptionRow[]>(() => rowsFromOptions(options));
  const [pkgRows, setPkgRows] = useState<PackageRow[]>(() => rowsFromPackages(packages));
  // Resync after a save, or rows without ids would be inserted again on the next save.
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

  // Spanish mode: the writer works in Spanish, and Send becomes "translate and review". Their wording is
  // shown back in English, editable, and only that English is sent; the customer never sees Spanish.
  const spanish = locale === "es";
  const [english, setEnglish] = useState<Record<string, string> | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  // What's already on the quote is the customer's English: reviewing it again sends nothing.
  useEffect(() => {
    if (!spanish) return;
    markEnglish([
      summary,
      ...QUOTE_SECTION_FIELDS.map((f) => initialSections?.[f]),
      ...options.flatMap((o) => [o.title, o.description]),
      ...packages.flatMap((p) => [p.title, p.description]),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanish, optionsSig, packagesSig]);

  // Line items own the price when present, so the total always matches the lines.
  const itemised = rows.length > 0;
  // No single price: the row carries the lead option plus everything else, as in the CRM.
  const choice = offersChoice(pkgRows);
  const derived = itemised || choice;
  const derivedTotal = Math.round(((choice ? leadPackageAmount(pkgRows) : 0) + rowsTotal(rows)) * 100) / 100;
  const priceNum = derived ? derivedTotal : Number(price);
  // Every option priced and more than one; the server refuses otherwise.
  const packagesReady =
    filledPackages(pkgRows).length === 0 ||
    (choice && filledPackages(pkgRows).every((r) => packageAmountOf(r) > 0));
  const hasLegacySummary = (summary ?? "").trim().length > 0;
  // Every section filled, or an older quote with free text.
  const sectionsReady = QUOTE_SECTION_FIELDS.every((f) => sections[f].trim()) || hasLegacySummary;

  // A correction must change something the customer read; the button waits for that.
  const changed =
    (derived ? derivedTotal !== Number(amount ?? 0) : price.trim() !== (amount != null ? String(amount) : "")) ||
    !rowsMatch(storedRows, rows) ||
    !packagesMatch(storedPkgRows, pkgRows) ||
    what.trim() !== (summary ?? "").trim() ||
    QUOTE_SECTION_FIELDS.some((f) => sections[f].trim() !== (initialSections?.[f] ?? "").trim());

  // Say what still blocks Send rather than showing an unexplained grey button.
  const sectionsLeft = hasLegacySummary ? 0 : blankSections(sections).length;
  const priceOk = (derived || price.trim() !== "") && Number.isFinite(priceNum) && priceNum > 0;

  const ready =
    (derived || price.trim() !== "") &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    packagesReady &&
    sectionsReady &&
    (!awaitingReply || changed);

  // Refresh so status and log match what just happened.
  useEffect(() => {
    if (state.ok || state.sent) router.refresh();
    // A successful send folds the form; a refusal keeps everything typed.
    if (state.sent && !state.error) {
      setOpen(false);
      setEnglish(null);
    }
  }, [state, router]);

  // Every field the customer reads, in page order; only the filled ones are translated.
  const sectionLabel: Record<QuoteSectionField, string> = {
    quote_scope: t.quoteForm.labelScope,
    quote_permits: t.quoteForm.labelPermits,
    quote_prep: t.quoteForm.labelPrep,
    quote_pour: t.quoteForm.labelPour,
    quote_cleanup: t.quoteForm.labelCleanup,
  };
  const sectionKind: Record<QuoteSectionField, TranslateField> = {
    quote_scope: "Quote section: Scope",
    quote_permits: "Quote section: Permits",
    quote_prep: "Quote section: Demolition and prep",
    quote_pour: "Quote section: Pour and finish",
    quote_cleanup: "Quote section: Clean up",
  };
  const sources: { field: EnglishField; kind: TranslateField; text: string }[] = [
    ...QUOTE_SECTION_FIELDS.map((f) => ({
      field: { key: `s:${f}`, label: sectionLabel[f] },
      kind: sectionKind[f],
      text: sections[f],
    })),
    ...(hasLegacySummary
      ? [{ field: { key: "what", label: t.english.summary }, kind: "Quote summary" as const, text: what }]
      : []),
    ...rows.flatMap((r, i) => [
      {
        field: { key: `r:${i}:t`, label: fill(t.english.line, { n: i + 1 }), short: true },
        kind: "Line item title" as const,
        text: r.title,
      },
      {
        field: { key: `r:${i}:d`, label: fill(t.english.lineDesc, { n: i + 1 }) },
        kind: "Line item description" as const,
        text: r.description,
      },
    ]),
    ...pkgRows.flatMap((r, i) => [
      {
        field: { key: `p:${i}:t`, label: fill(t.english.option, { n: i + 1 }), short: true },
        kind: "Option title" as const,
        text: r.title,
      },
      {
        field: { key: `p:${i}:d`, label: fill(t.english.optionDesc, { n: i + 1 }) },
        kind: "Option description" as const,
        text: r.description,
      },
    ]),
  ].filter((x) => x.text.trim() !== "");

  async function reviewInEnglish() {
    setTranslating(true);
    setTranslateError(null);
    const res = await toCustomerEnglish(sources.map((x) => ({ field: x.kind, text: x.text })));
    setTranslating(false);
    if (!res.ok) {
      setTranslateError(res.error);
      return;
    }
    setEnglish(Object.fromEntries(sources.map((x, i) => [x.field.key, res.texts[i]])));
  }

  // What Send submits: the reviewed English when there is one, else what was typed.
  const en = english ?? {};
  const outSections = english
    ? (Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, en[`s:${f}`] ?? sections[f]])) as Sections)
    : sections;
  const outWhat = english ? (en.what ?? what) : what;
  const outRows = english
    ? rows.map((r, i) => ({ ...r, title: en[`r:${i}:t`] ?? r.title, description: en[`r:${i}:d`] ?? r.description }))
    : rows;
  const outPkgRows = english
    ? pkgRows.map((r, i) => ({ ...r, title: en[`p:${i}:t`] ?? r.title, description: en[`p:${i}:d`] ?? r.description }))
    : pkgRows;

  // Rendered in all three states because a send folds the form away. Three outcomes: a 9pm quote's text is
  // held until 8am, which is neither sent nor failed.
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

  // Waiting on the customer, so no Send button (repeating the quote frustrates both sides). The one
  // exception is a quiet "correct it" action for a price typed wrong.
  if (awaitingReply && !open) {
    const when = sentAt
      ? new Date(sentAt).toLocaleString(intlLocale(locale), {
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
        {/*
          Intent rides on a hidden field, not the submit button, so it can't fall through to "save" and report
          success without texting.
        */}
        <input type="hidden" name="intent" value="send" />
        {/* JSON: a variable number of rows can't ride on named form fields. */}
        <input type="hidden" name="options_json" value={rowsToJson(outRows)} />
        <input type="hidden" name="packages_json" value={packagesToJson(outPkgRows)} />

        {english ? (
          <>
            {/* The fields' English replaces the editors, so what's reviewed is what's posted. */}
            <input type="hidden" name="quote_amount" value={derived ? String(derivedTotal) : price} />
            {QUOTE_SECTION_FIELDS.map((f) => (
              <input key={f} type="hidden" name={f} value={outSections[f]} />
            ))}
            {hasLegacySummary && <input type="hidden" name="quote_summary" value={outWhat} />}
            <EnglishReview
              fields={sources.map((x) => x.field)}
              values={english}
              onChange={(key, value) => setEnglish((e) => ({ ...(e ?? {}), [key]: value }))}
              customerFirstName={customerFirstName}
              locale={locale}
            />
          </>
        ) : (
          <>
            {/*
              Shared with the owner's editor and the customer page (components/quote-form-parts), so the crew fill in
              the page the customer gets.
            */}
            <PriceCard
              value={derived ? String(derivedTotal) : price}
              onChange={setPrice}
              derived={derived}
              derivedLabel={choice ? t.quoteForm.headlineDerived : undefined}
              locale={locale}
            />
            <SectionsEditor sections={sections} onChange={setSection} locale={locale} />

            {/*
              Always open: "what am I paying for" wins jobs. Adding a line makes the price card their sum; on a quote
              already sent, the gap to that price shows while typing.
            */}
            <OptionBuilder
              rows={rows}
              onChange={setRows}
              labels={t.quoteOptions}
              mode="breakdown"
              target={alreadySent ? amount : null}
              choiceActive={choice}
            />

            {/* Everything beyond a straight breakdown, folded; opens itself if the quote already uses any of it. */}
            <MoreWaysToPrice
              labels={t.quoteOptions}
              startOpen={rows.some((r) => !r.required) || filledPackages(pkgRows).length > 0}
            >
              <OptionBuilder rows={rows} onChange={setRows} labels={t.quoteOptions} mode="extras" />
              {/* Extras meant to be pick-one add up to every price at once; offered here, where the mistake is made. */}
              <PickOneSuggestion
                rows={rows}
                hasChoice={filledPackages(pkgRows).length > 0}
                locale={locale}
                onConvert={() => {
                  setPkgRows(packagesFromOptionRows(rows));
                  setRows([]);
                }}
              />
              <PackageBuilder rows={pkgRows} onChange={setPkgRows} labels={t.quotePackages} />
            </MoreWaysToPrice>

            {/* Only for quotes written before the sections existed. */}
            {hasLegacySummary && (
              <label className="jq-field">
                <span>{t.contractorJob.quoteSummary}</span>
                <SpellTextarea name="quote_summary" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
              </label>
            )}
          </>
        )}

        <CustomerPreview
          key={english ? "en" : "edit"}
          firstName={customerFirstName}
          price={priceOk ? priceNum : null}
          derived={derived}
          sections={outSections}
          {...previewOf(outRows)}
          choice={choice}
          locale={locale}
          startOpen={Boolean(english)}
        />

        <p className="js-hint">
          {awaitingReply
            ? fill(t.contractorJob.quoteFixWho, { name: customerFirstName })
            : t.contractorJob.quoteWho.replace("{name}", customerFirstName)}
        </p>

        {/* A correction that changes nothing is the duplicate text the rule exists to stop. */}
        {awaitingReply && !changed && <p className="js-hint">{t.contractorJob.quoteFixUnchanged}</p>}
        {!priceOk ? (
          <p className="jq-todo">{t.contractorJob.quoteNeedPrice}</p>
        ) : (
          sectionsLeft > 0 && (
            <p className="jq-todo">{fill(t.contractorJob.quoteNeedSections, { n: String(sectionsLeft) })}</p>
          )
        )}

        {spanish && !english ? (
          <button type="button" className="js-confirm jq-send" disabled={!ready || translating} onClick={reviewInEnglish}>
            {translating ? t.english.translating : t.english.translate}
          </button>
        ) : (
          <button type="submit" className="js-confirm jq-send" disabled={!ready || pending}>
            {pending
              ? t.contractorJob.quoteSending
              : awaitingReply
                ? t.contractorJob.quoteFixSend
                : t.contractorJob.quoteSend}
          </button>
        )}
        {english ? (
          <button type="button" className="jq-cancel" onClick={() => setEnglish(null)} disabled={pending}>
            {t.english.back}
          </button>
        ) : (
          <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending || translating}>
            {t.common.cancel}
          </button>
        )}
      </form>

      {translateError && <p className="js-err">{tr(locale, translateError)}</p>}

      {/* A refused duplicate isn't an error, so it reads as a note. */}
      {state.error && !pending && <p className={state.alreadySent ? "js-hint" : "js-err"}>{tr(locale, state.error)}</p>}
      {result}
    </section>
  );
}
