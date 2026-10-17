"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dollars, QUOTE_SECTION_FIELDS, type QuoteSectionField } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { saveQuote } from "@/app/crm/quotes/[id]/actions";
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
import { AutoTextarea } from "@/components/auto-textarea";
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
    if (state.sent && !state.error) setOpen(false);
  }, [state, router]);

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
        {/*
          Intent rides on a hidden field, not the submit button, so it can't fall through to "save" and report
          success without texting.
        */}
        <input type="hidden" name="intent" value="send" />
        {/* JSON: a variable number of rows can't ride on named form fields. */}
        <input type="hidden" name="options_json" value={rowsToJson(rows)} />
        <input type="hidden" name="packages_json" value={packagesToJson(pkgRows)} />

        {/*
          Shared with the owner's editor and the customer page (components/quote-form-parts), so the crew fill in
          the page the customer gets.
        */}
        <PriceCard
          value={derived ? String(derivedTotal) : price}
          onChange={setPrice}
          derived={derived}
          derivedLabel={choice ? "Headline price: the option you'd recommend plus extras" : undefined}
        />
        <SectionsEditor sections={sections} onChange={setSection} />

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
            <AutoTextarea name="quote_summary" rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />
          </label>
        )}

        <CustomerPreview
          firstName={customerFirstName}
          price={priceOk ? priceNum : null}
          derived={derived}
          sections={sections}
          {...previewOf(rows)}
          choice={choice}
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

      {/* A refused duplicate isn't an error, so it reads as a note. */}
      {state.error && !pending && <p className={state.alreadySent ? "js-hint" : "js-err"}>{state.error}</p>}
      {result}
    </section>
  );
}
