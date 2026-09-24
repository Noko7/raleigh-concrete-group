"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { dict } from "@/lib/crm/i18n";
import { dollars, packageLetter, QUOTE_SECTION_FIELDS, QUOTE_SECTION_LABELS, QUOTE_TTL_DAYS, type QuoteSectionField } from "@/lib/crm/constants";
import { saveQuote } from "./actions";
import {
  OptionBuilder,
  rowsFromOptions,
  rowsMatch,
  rowsToJson,
  rowsTotal,
  type OptionRow,
  type StoredOption,
} from "./option-builder";
import {
  PackageBuilder,
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
  PriceCard,
  SectionsEditor,
  type Sections,
} from "@/components/quote-form-parts";

// The quote itself: what the customer is sent and reads back. Name, status,
// crew and private notes are the job's, not the quote's, and live in
// JobSettings beside it - saveQuote only touches the fields a form posts, so
// the two save independently.
type Props = {
  id: string;
  // Line items, if this quote was written as a list of choices rather than one
  // price. Empty is the normal case and changes nothing.
  options: StoredOption[];
  // The ways of doing the job the customer may pick between. Empty on all but
  // the quote that was asked for two ways at once.
  packages: StoredPackage[];
  customerName: string;
  // Already texted and no answer yet. The owner can still send it again - a
  // customer saying "I never got it" is real and somebody has to be able to
  // act on it - but it becomes a deliberate second send rather than a repeat
  // of the same click.
  awaitingReply: boolean;
  initial: {
    quote_amount: number | null;
    quote_summary: string | null;
    customer_response: "accepted" | "declined" | null;
  } & Partial<Record<QuoteSectionField, string | null>>;
};

export function QuoteEditor({ id, options, packages, customerName, awaitingReply, initial }: Props) {
  const router = useRouter();
  const owner = dict("en");
  const optionLabels = owner.quoteOptions;
  const packageLabels = owner.quotePackages;
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  // Everything is controlled so the form always shows the saved truth. When the
  // server data changes (after a save, or a customer action elsewhere) we resync
  // the fields to it - that's the "stateful" behaviour the board needs.
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

  // The stored line items, in the shape the builder edits. Rebuilt only when the
  // server data actually changes, so typing in the builder isn't clobbered.
  const optionsSig = useMemo(
    () => options.map((o) => `${o.id}|${o.title}|${o.description ?? ""}|${o.amount}|${o.required}`).join("~"),
    [options],
  );
  const storedRows = useMemo(() => rowsFromOptions(options), [optionsSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Built by hand rather than with Object.fromEntries, which widens the value
  // back to a bare string and loses the union the builder is typed on.
  const answers = useMemo(() => {
    const out: Record<string, "accepted" | "declined" | null> = {};
    for (const o of options) out[o.id] = o.customer_response;
    return out;
  }, [options]);
  useEffect(() => {
    setRows(rowsFromOptions(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsSig]);

  // Same resync for the choice of options, and for the same reason: until the
  // saved ids are back in state, the next save would insert a second copy of
  // every card instead of updating the ones just written.
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

  // After any successful save/send, pull fresh server data so the status badge,
  // activity log and the rest of the page reflect the change immediately.
  useEffect(() => {
    if (state.sent) setConfirming(false);
    if (state.ok || state.sent) router.refresh();
  }, [state, router]);

  // With line items the price is their sum and the box below just reports it.
  // Two editable numbers that are meant to agree is how a quote goes out with a
  // total that matches nothing on it.
  // Once they have answered, the price on the row is what they actually bought,
  // not the sum of everything they were offered - so the box goes back to
  // showing (and editing) that figure.
  const locked = Boolean(initial.customer_response);
  const itemised = rows.length > 0 && !locked;
  // A choice of ways to do the job. There is no single price on such a quote -
  // the customer settles it when they pick - so the row carries the lead option
  // plus everything else, which is exactly what the server stores.
  const choice = offersChoice(pkgRows) && !locked;
  const pkgs = filledPackages(pkgRows);
  const itemTotal = rowsTotal(rows);
  const derived = itemised || choice;
  const derivedTotal = Math.round(((choice ? leadPackageAmount(pkgRows) : 0) + itemTotal) * 100) / 100;
  const amountNum = derived ? derivedTotal : Number(amount);
  const amountValid = derived ? derivedTotal > 0 : amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const previewPrice = amountValid ? (dollars(amountNum) ?? "N/A") : "N/A";
  // Every option needs its own price. A $0 card next to a priced one does not
  // read as free, it reads as a quote somebody didn't finish - and it is the
  // cheapest thing on the page. The server refuses it too.
  const unpricedPackage = choice ? pkgs.find((r) => packageAmountOf(r) <= 0) : undefined;

  // Which of the five are still blank. A quote written before the sections
  // existed is allowed out on its old summary instead, matching the server.
  const blankSections = blanksOf(sections);
  const hasLegacySummary = summary.trim().length > 0;
  const sectionsValid = blankSections.length === 0 || hasLegacySummary;

  const setSection = (field: QuoteSectionField, value: string) =>
    setSections((s) => ({ ...s, [field]: value }));

  // Sending to a customer who already has this quote is one of two different
  // acts, and what separates them is whether the quote itself changed. Edited
  // here, it goes out as a correction and the customer is told so; untouched,
  // it's the same quote again and only worth sending if it never arrived. The
  // server draws the same line - this is only what the panel says about it.
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
      {/* The intent rides on a hidden field rather than the submit button's
          name/value. Relying on the submitter meant that if it didn't reach the
          server the action silently fell through to "save": no text sent, no
          activity logged, and a green "Saved" as if it had worked. The confirm
          panel is only open when sending, so this can't disagree with the
          button the user actually pressed. */}
      {/* Opening the confirm panel on a quote that's already out IS the
          deliberate act the server asks for, so it sends "resend" rather than
          bouncing off the duplicate guard and making the owner hunt for a
          second button. The panel says plainly what that means. */}
      <input type="hidden" name="intent" value={confirming ? (awaitingReply ? "resend" : "send") : "save"} />
      {/* The whole list, as JSON. A variable number of rows can't ride on named
          form fields without inventing an indexing scheme the server then has
          to un-invent. Not sent once the customer has answered: the rows are
          their receipt by then, and the action refuses to rewrite them anyway. */}
      {!locked && <input type="hidden" name="options_json" value={rowsToJson(rows)} />}
      {!locked && <input type="hidden" name="packages_json" value={packagesToJson(pkgRows)} />}

      <div className="crm-paper-head">
        <h2 className="crm-card-title">Quote</h2>
        <span className="crm-paper-sub">
          {locked
            ? `${customerName.split(" ")[0]} has answered. The line items are their record now.`
            : "What the customer gets, laid out the way they read it."}
        </span>
      </div>

      {/* The same price card and section timeline as the crew's form and the
          customer's own page (components/quote-form-parts). */}
      <PriceCard
        value={derived ? String(derivedTotal) : amount}
        onChange={setAmount}
        derived={derived}
        derivedLabel={
          choice ? "Headline price: the option you'd recommend plus extras" : "Total, from the line items below"
        }
      />

      <SectionsEditor sections={sections} onChange={setSection} idPrefix="qe" />

      {/* The extras, after the everyday path: most quotes are one price and
          five sections. Adding a line item turns the price card into a total. */}
      <OptionBuilder rows={rows} onChange={setRows} labels={optionLabels} locked={locked} answers={answers} />
      <PackageBuilder rows={pkgRows} onChange={setPkgRows} labels={packageLabels} locked={locked} answers={packageAnswers} />

      {/* Only for quotes written before the sections existed. Hidden entirely
          on new ones so nobody fills in a sixth box that nothing displays. */}
      {hasLegacySummary && (
        <label className="jq-field">
          <span>Older quote summary (shown only while the sections above are blank)</span>
          <AutoTextarea name="quote_summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
      )}

      {!confirming && (
        <CustomerPreview
          firstName={customerName.split(" ")[0]}
          price={amountValid ? amountNum : null}
          derived={derived}
          sections={sections}
        />
      )}

      {confirming ? (
        <div className="crm-confirm">
          <h3>
            {correcting ? "Send the corrected quote" : awaitingReply ? "Send this quote again" : "Send this quote"} to{" "}
            {customerName.split(" ")[0]}?
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
          {/* Exactly the choice the customer is about to be asked to make, at
              the last moment somebody can still spot that Option B is the one
              with last week's price on it. */}
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
          {/* Exactly the choice the customer is about to be given, so nobody
              sends a quote whose optional extra was meant to be part of the job. */}
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
              firstName={customerName.split(" ")[0]}
              price={amountValid ? amountNum : null}
              derived={derived}
              sections={sections}
              startOpen
            />
          ) : (
            <div className="crm-confirm-summary">{summary}</div>
          )}
          <div className="crm-editor-foot">
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            {/* No name/value: the hidden intent field above is the single source
                of truth, and a second "intent" here could only disagree with it. */}
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

          {/* Sending is the one action with a real-world outcome, so it gets an
              unambiguous banner rather than a line of grey text. */}
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
              {/* A hold is not a problem to fix, so it gets the fact and nothing
                  else - no provider dump, no "check your settings". */}
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
            Send texts {customerName.split(" ")[0]} their link, good for {QUOTE_TTL_DAYS} days. The price is never in
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
