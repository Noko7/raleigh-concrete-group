"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { dict } from "@/lib/crm/i18n";
import { firstNameOf, dollars, packageLetter, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, QUOTE_TTL_DAYS, type QuoteSectionField } from "@/lib/crm/constants";
import { saveQuote } from "./actions";
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
} from "./option-builder";
import {
  PackageBuilder,
  packagesFromOptionRows,
  filledPackages,
  leadPackageAmount,
  offersChoice,
  packagesMatch,
  packagesToJson,
  packageAmountOf,
  rowsFromPackages,
  type PackageRow,
  type StoredPackage,
} from "./package-builder";
import type { SaveState } from "./types";
import { AutoTextarea } from "@/components/auto-textarea";
import {
  blankSections as blanksOf,
  CustomerPreview,
  emptySections,
  PickOneSuggestion,
  PriceCard,
  SectionsEditor,
  type Sections,
} from "@/components/quote-form-parts";

// The quote itself: what the customer is sent. Name, status, crew and notes
// belong to the job (JobSettings); saveQuote only touches posted fields, so the
// two save independently.
type Props = {
  id: string;
  // Line items, if written as a list rather than one price. Usually empty.
  options: StoredOption[];
  // Alternative ways of doing the job; usually empty.
  packages: StoredPackage[];
  customerName: string;
  // Texted, no answer yet. The owner can still resend ("I never got it"), as a
  // deliberate second send.
  awaitingReply: boolean;
  initial: {
    quote_amount: number | null;
    quote_summary: string | null;
    customer_response: "accepted" | "declined" | null;
    // A declined quote is locked only while still Lost; moved off Lost, the next
    // save reopens it (saveQuote).
    status: string;
  } & Partial<Record<QuoteSectionField, string | null>>;
};

export function QuoteEditor({ id, options, packages, customerName, awaitingReply, initial }: Props) {
  const router = useRouter();
  const owner = dict("en");
  const optionLabels = owner.quoteOptions;
  const packageLabels = owner.quotePackages;
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  // Controlled fields, resynced whenever server data changes (a save, or a
  // customer action elsewhere), so the form always shows the saved truth.
  const [amount, setAmount] = useState(initial.quote_amount != null ? String(initial.quote_amount) : "");
  const [summary, setSummary] = useState(initial.quote_summary ?? "");
  const [sections, setSections] = useState<Sections>(() => ({
    ...emptySections(),
    ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initial[f] ?? ""])),
  }));
  const [rows, setRows] = useState<OptionRow[]>(() => rowsFromOptions(options));
  const [pkgRows, setPkgRows] = useState<PackageRow[]>(() => rowsFromPackages(packages));
  const [confirming, setConfirming] = useState(false);
  const [localErr, setLocalErr] = useState("");

  // Stored line items in builder shape, rebuilt only when server data changes
  // so typing isn't clobbered.
  const optionsSig = useMemo(
    () => options.map((o) => `${o.id}|${o.title}|${o.description ?? ""}|${o.amount}|${o.required}`).join("~"),
    [options],
  );
  const storedRows = useMemo(() => rowsFromOptions(options), [optionsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Built by hand: Object.fromEntries widens the value to string and loses the union.
  const answers = useMemo(() => {
    const out: Record<string, "accepted" | "declined" | null> = {};
    for (const o of options) out[o.id] = o.customer_response;
    return out;
  }, [options]);
  useEffect(() => {
    setRows(rowsFromOptions(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsSig]);

  // Same resync for packages: until saved ids are back in state, the next save
  // would insert duplicates.
  const packagesSig = useMemo(
    () => packages.map((p) => `${p.id}|${p.title}|${p.description ?? ""}|${p.amount}|${p.recommended}`).join("~"),
    [packages],
  );
  const storedPkgRows = useMemo(() => rowsFromPackages(packages), [packagesSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const packageAnswers = useMemo(() => {
    const out: Record<string, "accepted" | "declined" | null> = {};
    for (const p of packages) out[p.id] = p.customer_response;
    return out;
  }, [packages]);
  useEffect(() => {
    setPkgRows(rowsFromPackages(packages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packagesSig]);

  const initialSig = useMemo(
    () =>
      [
        initial.quote_amount ?? "",
        initial.quote_summary ?? "",
        ...QUOTE_SECTION_FIELDS.map((f) => initial[f] ?? ""),
      ].join("|"),
    [initial],
  );
  useEffect(() => {
    setAmount(initial.quote_amount != null ? String(initial.quote_amount) : "");
    setSummary(initial.quote_summary ?? "");
    setSections({
      ...emptySections(),
      ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initial[f] ?? ""])),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSig]);

  // After a save/send, refresh so badge, log and page reflect it immediately.
  useEffect(() => {
    if (state.sent) setConfirming(false);
    if (state.ok || state.sent) router.refresh();
  }, [state, router]);

  // With line items the price is their sum and the box only reports it (two
  // editable numbers would drift). Once answered, the row's price is what they
  // bought, so the box shows and edits that figure again.
  const locked =
    initial.customer_response === "accepted" ||
    (initial.customer_response === "declined" && initial.status === "lost");
  const itemised = rows.length > 0 && !locked;
  // A choice has no single price; the row carries the lead option plus extras,
  // as the server stores.
  const choice = offersChoice(pkgRows) && !locked;
  const pkgs = filledPackages(pkgRows);
  const itemTotal = rowsTotal(rows);
  const derived = itemised || choice;
  const derivedTotal = Math.round(((choice ? leadPackageAmount(pkgRows) : 0) + itemTotal) * 100) / 100;
  const amountNum = derived ? derivedTotal : Number(amount);
  const amountValid = derived ? derivedTotal > 0 : amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const previewPrice = amountValid ? (dollars(amountNum) ?? "N/A") : "N/A";
  // Every option needs a price: a $0 card reads as unfinished. The server refuses it too.
  const unpricedPackage = choice ? pkgs.find((r) => packageAmountOf(r) <= 0) : undefined;

  // Blank sections. Pre-sections quotes may go out on their legacy summary, as on the server.
  const blankSections = blanksOf(sections);
  const hasLegacySummary = summary.trim().length > 0;
  const sectionsValid = blankSections.length === 0 || hasLegacySummary;

  const setSection = (field: QuoteSectionField, value: string) =>
    setSections((s) => ({ ...s, [field]: value }));

  // Resending an already-sent quote: edited means a correction (the customer is
  // told); untouched means a duplicate, only worth it if it never arrived. The
  // server draws the same line; this only drives the panel's wording.
  const quoteEdited =
    (derived ? derivedTotal !== Number(initial.quote_amount ?? 0) : amount.trim() !== (initial.quote_amount != null ? String(initial.quote_amount) : "")) ||
    !rowsMatch(storedRows, rows) ||
    !packagesMatch(storedPkgRows, pkgRows) ||
    summary.trim() !== (initial.quote_summary ?? "").trim() ||
    QUOTE_SECTION_FIELDS.some((f) => sections[f].trim() !== (initial[f] ?? "").trim());
  const correcting = awaitingReply && quoteEdited;

  function openConfirm() {
    if (!choice && pkgs.length > 0) {
      setLocalErr(
        "This quote has one option on it, which is not a choice. Add a second option, or remove the one you have.",
      );
    } else if (unpricedPackage) {
      setLocalErr(`Put a price on every option before sending. "${unpricedPackage.title.trim()}" has none.`);
    } else if (!amountValid) {
      setLocalErr(
        choice
          ? "Put a price on every option before sending."
          : itemised
            ? "Put a price on at least one line item before sending."
            : "Add a quote price before sending.",
      );
    } else if (!sectionsValid) {
      const names = blankSections.map((f) => QUOTE_SECTION_LABELS[f]).join(", ");
      setLocalErr(`Fill in every section first. Still blank: ${names}. Use "Not applicable" where a section doesn't apply.`);
    } else {
      setLocalErr("");
      setConfirming(true);
    }
  }

  return (
    <form action={formAction} className="crm-card crm-editor crm-paper" id="quote">
      <input type="hidden" name="id" value={id} />
      {/* Intent rides on a hidden field, not the submit button's name/value: if
          the submitter didn't reach the server the action silently fell back to
          "save" and showed "Saved". The confirm panel is only open when sending,
          so it can't disagree with the pressed button. On a quote already out,
          opening the panel is the deliberate act, so it sends "resend". */}
      <input type="hidden" name="intent" value={confirming ? (awaitingReply ? "resend" : "send") : "save"} />
      {/* The whole list as JSON (a variable number of rows). Not sent once
          answered: the rows are their receipt, and the action refuses anyway. */}
      {!locked && <input type="hidden" name="options_json" value={rowsToJson(rows)} />}
      {!locked && <input type="hidden" name="packages_json" value={packagesToJson(pkgRows)} />}

      <div className="crm-paper-head">
        <h2 className="crm-card-title">Quote</h2>
        <span className="crm-paper-sub">
          {initial.customer_response === "declined"
            ? initial.status === "lost"
              ? `${firstNameOf(customerName, customerName)} declined this quote. Sending it again reopens it, and so does moving the job off Lost.`
              : `${firstNameOf(customerName, customerName)} declined, and the job has been moved off Lost. Saving or sending reopens the quote.`
            : locked
              ? `${firstNameOf(customerName, customerName)} has answered. The line items are their record now.`
              : "What the customer gets, laid out the way they read it."}
        </span>
      </div>

      {/* Same price card and section timeline as the crew's form and the
          customer's page (components/quote-form-parts). */}
      <PriceCard
        value={derived ? String(derivedTotal) : amount}
        onChange={setAmount}
        derived={derived}
        derivedLabel={
          choice ? "Headline price: the option you'd recommend plus extras" : "Total, from the price breakdown below"
        }
      />

      <SectionsEditor sections={sections} onChange={setSection} idPrefix="qe" />

      {locked ? (
        <>
          {/* Answered: one combined list, as the record of what they bought. */}
          <OptionBuilder rows={rows} onChange={setRows} labels={optionLabels} locked answers={answers} />
          <PackageBuilder rows={pkgRows} onChange={setPkgRows} labels={packageLabels} locked answers={packageAnswers} />
        </>
      ) : (
        <>
          {/* As on the crew's form: breakdown open, the rest folded. One rows
              array behind both, so total and save see one list. */}
          <OptionBuilder
            rows={rows}
            onChange={setRows}
            labels={optionLabels}
            mode="breakdown"
            target={awaitingReply ? Number(initial.quote_amount ?? 0) || null : null}
            choiceActive={choice}
          />
          <MoreWaysToPrice
            labels={optionLabels}
            startOpen={rows.some((r) => !r.required) || filledPackages(pkgRows).length > 0}
          >
            <OptionBuilder rows={rows} onChange={setRows} labels={optionLabels} mode="extras" />
            {/* Extras meant as pick-ONE add up to every price at once; suggested
                here, where the mistake is made. */}
            <PickOneSuggestion
              rows={rows}
              hasChoice={filledPackages(pkgRows).length > 0}
              onConvert={() => {
                setPkgRows(packagesFromOptionRows(rows));
                setRows([]);
              }}
            />
            <PackageBuilder rows={pkgRows} onChange={setPkgRows} labels={packageLabels} />
          </MoreWaysToPrice>
        </>
      )}

      {/* Legacy quotes only; hidden on new ones so nobody fills a box nothing displays. */}
      {hasLegacySummary && (
        <label className="jq-field">
          <span>Older quote summary (shown only while the sections above are blank)</span>
          <AutoTextarea name="quote_summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
      )}

      {!confirming && (
        <CustomerPreview
          firstName={firstNameOf(customerName, customerName)}
          price={amountValid ? amountNum : null}
          derived={derived}
          sections={sections}
          {...previewOf(rows)}
          choice={choice}
        />
      )}

      {confirming ? (
        <div className="crm-confirm">
          <h3>
            {correcting ? "Send the corrected quote" : awaitingReply ? "Send this quote again" : "Send this quote"} to{" "}
            {firstNameOf(customerName, customerName)}?
          </h3>
          <p className="crm-muted crm-sm">
            {correcting
              ? "They're holding the earlier version and haven't replied. This replaces it: they get a text saying the quote was updated, and the link they already have shows the new one."
              : awaitingReply
                ? "They already have this quote and haven't replied. Sending again puts a second copy on their phone, so do it if they say the first never arrived."
                : `We'll text them their quote link, good for ${QUOTE_TTL_DAYS} days. The price is never in the text.`}
          </p>
          <div className="crm-confirm-row">
            <span>{choice ? "Price, on the option you'd recommend" : itemised ? "Price, if they take everything" : "Price"}</span>
            <strong>{previewPrice}</strong>
          </div>
          {/* The choice the customer will see: the last chance to spot an option
              with a stale price. */}
          {choice && (
            <ul className="crm-confirm-options">
              {pkgs.map((r, i) => (
                <li key={r.key}>
                  <span>{`${packageLabels.optionWord} ${packageLetter(i)}: ${r.title}`}</span>
                  <strong>{dollars(packageAmountOf(r))}</strong>
                  <em>{r.recommended ? "recommended" : "they choose"}</em>
                </li>
              ))}
            </ul>
          )}
          {/* The extras the customer will see, so nothing meant as part of the
              job goes out as optional. */}
          {itemised && (
            <ul className="crm-confirm-options">
              {rows
                .filter((r) => r.title.trim())
                .map((r) => (
                  <li key={r.key}>
                    <span>{r.title}</span>
                    <strong>{dollars(Number(r.amount) || 0)}</strong>
                    <em>{r.required ? "included" : "they choose"}</em>
                  </li>
                ))}
            </ul>
          )}
          {/* Exactly what they'll read, drawn by the component their page uses. */}
          {blankSections.length === 0 ? (
            <CustomerPreview
              firstName={firstNameOf(customerName, customerName)}
              price={amountValid ? amountNum : null}
              derived={derived}
              sections={sections}
              {...previewOf(rows)}
              choice={choice}
              startOpen
            />
          ) : (
            <div className="crm-confirm-summary">{summary}</div>
          )}
          <div className="crm-editor-foot">
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            {/* No name/value: the hidden intent field is the single source of truth. */}
            <button type="submit" className="crm-btn crm-btn-send" disabled={pending}>
              {pending ? "Sending…" : correcting ? "Send correction" : awaitingReply ? "Send again" : "Confirm & send"}
            </button>
          </div>
          {state.error && !pending && <p className="crm-auth-error crm-confirm-error">{state.error}</p>}
        </div>
      ) : (
        <>
          <div className="crm-editor-foot">
            <button type="submit" name="intent" value="save" className="crm-btn crm-btn-ghost" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="crm-btn crm-btn-send" onClick={openConfirm} disabled={pending}>
              {correcting ? "Send corrected Quote" : awaitingReply ? "Send Quote again" : "Send Quote"}
            </button>
            {state.ok && !state.sent && !pending && !state.error && <span className="crm-saved">Saved</span>}
            {(localErr || state.error) && <span className="crm-auth-error">{localErr || state.error}</span>}
          </div>

          {/* Sending has a real-world outcome, so it gets a clear banner. */}
          {state.sent && !pending && !state.error && (
            <div
              className={`send-result ${
                state.smsDelivered ? "send-result-ok" : state.smsHeldUntil ? "send-result-held" : "send-result-bad"
              }`}
            >
              <strong>
                {state.smsDelivered
                  ? `Quote sent, texted to ${state.smsTo ?? "the customer"}`
                  : state.smsHeldUntil
                    ? `Quote saved. The text goes out ${state.smsHeldUntil}`
                    : "Quote saved, but the text did NOT go out"}
              </strong>
              {/* A hold isn't a problem: just the fact, no provider dump. */}
              {state.smsHeldUntil && (
                <p className="crm-sm">
                  Nothing goes out between 7pm and 8am. It&apos;s queued and will send itself; the customer link below
                  works now if it can&apos;t wait.
                </p>
              )}
              {!state.smsDelivered && !state.smsHeldUntil && (
                <>
                  <p className="crm-sm">
                    The quote link is live, so copy the customer link below and send it yourself. Then check Settings →
                    Text notifications.
                  </p>
                  {state.smsError && <pre className="send-result-detail">{state.smsError}</pre>}
                </>
              )}
            </div>
          )}
          <p className="crm-muted crm-sm crm-editor-hint">
            Send texts {firstNameOf(customerName, customerName)} their link, good for {QUOTE_TTL_DAYS} days. The price is never in
            the text.
            {itemised
              ? " This quote has line items, so the customer answers each one and their total follows what they picked."
              : ""}
            {choice
              ? " This quote offers a choice of options, so the customer picks one and their price is settled when they do."
              : ""}
          </p>
        </>
      )}
    </form>
  );
}
