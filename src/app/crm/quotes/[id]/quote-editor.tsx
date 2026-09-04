"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { dict } from "@/lib/crm/i18n";
import {
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_HINTS,
  QUOTE_SECTION_LABELS,
  STATUSES,
  STATUS_LABELS,
  type QuoteSectionField,
} from "@/lib/crm/constants";
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
import type { SaveState } from "./types";

type ContractorOption = { id: string; label: string };

type Sections = Record<QuoteSectionField, string>;

const emptySections = (): Sections =>
  Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, ""])) as Sections;

type Props = {
  id: string;
  isOwner: boolean;
  // Line items, if this quote was written as a list of choices rather than one
  // price. Empty is the normal case and changes nothing.
  options: StoredOption[];
  customerName: string;
  // Already texted and no answer yet. The owner can still send it again - a
  // customer saying "I never got it" is real and somebody has to be able to
  // act on it - but it becomes a deliberate second send rather than a repeat
  // of the same click.
  awaitingReply: boolean;
  contractors: ContractorOption[];
  initial: {
    status: string;
    name: string;
    assigned_to: string | null;
    quote_amount: number | null;
    quote_summary: string | null;
    internal_notes: string | null;
    customer_response: "accepted" | "declined" | null;
  } & Partial<Record<QuoteSectionField, string | null>>;
};

export function QuoteEditor({ id, isOwner, options, customerName, awaitingReply, contractors, initial }: Props) {
  const router = useRouter();
  // Owner-facing screen, so English. The builder takes its words as a prop
  // because the crew's copy of it renders in whichever language they chose.
  const optionLabels = dict("en").quoteOptions;
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });

  // Everything is controlled so the form always shows the saved truth. When the
  // server data changes (after a save, or a customer action elsewhere) we resync
  // the fields to it - that's the "stateful" behaviour the board needs.
  const [status, setStatus] = useState(initial.status);
  const [name, setName] = useState(initial.name);
  const [assigned, setAssigned] = useState(initial.assigned_to ?? "");
  const [amount, setAmount] = useState(initial.quote_amount != null ? String(initial.quote_amount) : "");
  const [summary, setSummary] = useState(initial.quote_summary ?? "");
  const [sections, setSections] = useState<Sections>(() => ({
    ...emptySections(),
    ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initial[f] ?? ""])),
  }));
  const [notes, setNotes] = useState(initial.internal_notes ?? "");
  const [rows, setRows] = useState<OptionRow[]>(() => rowsFromOptions(options));
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

  const initialSig = useMemo(
    () =>
      [
        initial.status,
        initial.name,
        initial.assigned_to ?? "",
        initial.quote_amount ?? "",
        initial.quote_summary ?? "",
        initial.internal_notes ?? "",
        ...QUOTE_SECTION_FIELDS.map((f) => initial[f] ?? ""),
      ].join("|"),
    [initial],
  );
  useEffect(() => {
    setStatus(initial.status);
    setName(initial.name);
    setAssigned(initial.assigned_to ?? "");
    setAmount(initial.quote_amount != null ? String(initial.quote_amount) : "");
    setSummary(initial.quote_summary ?? "");
    setSections({
      ...emptySections(),
      ...Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, initial[f] ?? ""])),
    });
    setNotes(initial.internal_notes ?? "");
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
  const itemTotal = rowsTotal(rows);
  const amountNum = itemised ? itemTotal : Number(amount);
  const amountValid = itemised ? itemTotal > 0 : amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const previewPrice = amountValid ? `$${amountNum.toLocaleString("en-US")}` : "N/A";

  // Which of the five are still blank. A quote written before the sections
  // existed is allowed out on its old summary instead, matching the server.
  const blankSections = QUOTE_SECTION_FIELDS.filter((f) => !sections[f].trim());
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
    (itemised ? itemTotal !== Number(initial.quote_amount ?? 0) : amount.trim() !== (initial.quote_amount != null ? String(initial.quote_amount) : "")) ||
    !rowsMatch(storedRows, rows) ||
    summary.trim() !== (initial.quote_summary ?? "").trim() ||
    QUOTE_SECTION_FIELDS.some((f) => sections[f].trim() !== (initial[f] ?? "").trim());
  const correcting = awaitingReply && quoteEdited;

  function openConfirm() {
    if (!amountValid) {
      setLocalErr(itemised ? "Put a price on at least one line item before sending." : "Add a quote price before sending.");
    } else if (!sectionsValid) {
      const names = blankSections.map((f) => QUOTE_SECTION_LABELS[f]).join(", ");
      setLocalErr(`Fill in every section first. Still blank: ${names}. Use "Not applicable" where a section doesn't apply.`);
    } else {
      setLocalErr("");
      setConfirming(true);
    }
  }

  return (
    <form action={formAction} className="crm-card crm-editor">
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

      {/* The name every later text opens with. Arrives from a web form or a
          phone call, so it is wrong often enough to need fixing here. */}
      <label className="crm-field">
        <span>Customer name</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="crm-input"
          maxLength={120}
        />
      </label>

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Status</span>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="crm-input">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        {isOwner && (
          <label className="crm-field">
            <span>Assigned contractor</span>
            <select name="assigned_to" value={assigned} onChange={(e) => setAssigned(e.target.value)} className="crm-input">
              <option value="">Unassigned</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="crm-field">
          <span>{itemised ? "Quote amount ($) - from the line items" : "Quote amount ($) *"}</span>
          <input
            type="number"
            name="quote_amount"
            min={0}
            step="0.01"
            value={itemised ? String(itemTotal) : amount}
            onChange={(e) => setAmount(e.target.value)}
            className="crm-input"
            placeholder="e.g. 6500"
            readOnly={itemised}
            title={itemised ? "Edit the line items below to change this." : undefined}
          />
        </label>
      </div>

      {/* Between the price and the five sections, which is the order it gets
          written in: what the job is made of, then how all of it is done. */}
      <OptionBuilder
        rows={rows}
        onChange={setRows}
        labels={optionLabels}
        locked={locked}
        answers={answers}
      />

      {/* The five sections the customer reads, in the order they read them.
          Separate boxes rather than one, because a single box is how permits
          and cleanup quietly go unmentioned. */}
      <fieldset className="crm-sections">
        <legend>What the customer sees</legend>
        <p className="crm-muted crm-sm">
          All five are required to send. Put &quot;Not applicable&quot; where a section doesn&apos;t apply to this job.
        </p>
        {QUOTE_SECTION_FIELDS.map((field) => (
          <label key={field} className="crm-field">
            <span>
              {QUOTE_SECTION_LABELS[field]} *
              {!sections[field].trim() && (
                <button
                  type="button"
                  className="crm-na-btn"
                  onClick={() => setSection(field, "Not applicable")}
                >
                  Not applicable
                </button>
              )}
            </span>
            <textarea
              name={field}
              rows={2}
              value={sections[field]}
              onChange={(e) => setSection(field, e.target.value)}
              className="crm-input"
              placeholder={QUOTE_SECTION_HINTS[field]}
            />
          </label>
        ))}
      </fieldset>

      {/* Only for quotes written before the sections existed. Hidden entirely
          on new ones so nobody fills in a sixth box that nothing displays. */}
      {hasLegacySummary && (
        <label className="crm-field">
          <span>Older quote summary (shown only while the sections above are blank)</span>
          <textarea
            name="quote_summary"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="crm-input"
          />
        </label>
      )}

      <label className="crm-field">
        <span>Internal notes (never shown to the customer)</span>
        <textarea
          name="internal_notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="crm-input"
          placeholder="Notes for you and the crew."
        />
      </label>

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
                : "We'll text them their quote link, good for 7 days. The price is never in the text."}
          </p>
          <div className="crm-confirm-row">
            <span>{itemised ? "Price, if they take everything" : "Price"}</span>
            <strong>{previewPrice}</strong>
          </div>
          {/* Exactly the choice the customer is about to be given, so nobody
              sends a quote whose optional extra was meant to be part of the job. */}
          {itemised && (
            <ul className="crm-confirm-options">
              {rows
                .filter((r) => r.title.trim())
                .map((r) => (
                  <li key={r.key}>
                    <span>{r.title}</span>
                    <strong>${Number(r.amount || 0).toLocaleString("en-US")}</strong>
                    <em>{r.required ? "included" : "they choose"}</em>
                  </li>
                ))}
            </ul>
          )}
          {/* Exactly what they'll read, in the order they'll read it. */}
          <div className="crm-confirm-summary">
            {blankSections.length === 0
              ? QUOTE_SECTION_FIELDS.map((f) => (
                  <p key={f}>
                    <strong>{QUOTE_SECTION_LABELS[f]}:</strong> {sections[f]}
                  </p>
                ))
              : summary}
          </div>
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
            Price and all five sections are required to send. Send Quote texts the customer their link, good for 7 days,
            and marks this Sent. The price itself is never in the text.
            {itemised
              ? " This quote has line items, so the customer answers each one and their total follows what they picked."
              : ""}
          </p>
        </>
      )}
    </form>
  );
}
