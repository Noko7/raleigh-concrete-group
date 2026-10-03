"use client";

import { useState, type ReactNode } from "react";

import { dollars, MAX_QUOTE_OPTIONS, OPTION_TITLE_MAX } from "@/lib/crm/constants";
import type { dict } from "@/lib/crm/i18n";
import { AutoTextarea } from "@/components/auto-textarea";

// The line-item builder, shared by the CRM editor and the crew's job page so a
// quote written from a truck can offer the same choices as one written at a
// desk. Controlled: the parent owns the rows, because it also needs the total
// (for the amount it shows) and the JSON (for the hidden input the action reads).
export type OptionLabels = ReturnType<typeof dict>["quoteOptions"];

// A row being edited. `key` is a client-side identity so React can track a row
// that has no database id yet; `id` is the stored row this one came from, and
// keeping it is what preserves the customer's answer across an edit.
export type OptionRow = {
  key: string;
  id?: string;
  title: string;
  description: string;
  // Held as a string, not a number: an empty box and a zero are different
  // things while somebody is typing, and only one of them is a price.
  amount: string;
  required: boolean;
};

export type StoredOption = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  required: boolean;
  customer_response: "accepted" | "declined" | null;
};

let seq = 0;
const nextKey = () => `row-${++seq}`;

export function rowsFromOptions(options: StoredOption[]): OptionRow[] {
  return options.map((o) => ({
    key: nextKey(),
    id: o.id,
    title: o.title,
    description: o.description ?? "",
    amount: String(o.amount),
    required: o.required,
  }));
}

export function blankRow(required = false): OptionRow {
  return { key: nextKey(), id: undefined, title: "", description: "", amount: "", required };
}

export const rowAmount = (r: OptionRow): number => {
  const n = Number(r.amount);
  return Number.isFinite(n) ? n : 0;
};

// Blank rows are dropped rather than refused: adding one and thinking better of
// it is not a mistake anybody should have to go back and clear.
export const filledRows = (rows: OptionRow[]) => rows.filter((r) => r.title.trim() !== "");

export const rowsTotal = (rows: OptionRow[]): number =>
  Math.round(filledRows(rows).reduce((sum, r) => sum + rowAmount(r), 0) * 100) / 100;

// What the server action reads out of `options_json`.
export const rowsToJson = (rows: OptionRow[]): string =>
  JSON.stringify(
    filledRows(rows).map((r) => ({
      id: r.id,
      title: r.title.trim(),
      description: r.description.trim(),
      amount: rowAmount(r),
      required: r.required,
    })),
  );

// What the customer preview needs from the rows: the breakdown lines exactly as
// they will be saved (blank ones dropped, same rounding), and how many extras
// the customer will be asked about. One helper, so all three previews agree.
export function previewOf(rows: OptionRow[]) {
  const filled = filledRows(rows);
  return {
    lines: filled
      .filter((r) => r.required)
      .map((r) => ({ title: r.title.trim(), amount: rowAmount(r), description: r.description.trim() || undefined })),
    extras: filled.filter((r) => !r.required).length,
  };
}

// Two lists describe the same offer. Used by both editors to tell a correction
// apart from a re-send of the same quote.
export function rowsMatch(a: OptionRow[], b: OptionRow[]): boolean {
  const norm = (rows: OptionRow[]) =>
    filledRows(rows).map((r) => `${r.title.trim()}|${r.description.trim()}|${rowAmount(r)}|${r.required}`);
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const usd = (n: number) => dollars(n) ?? "$0";

// The everyday parts of a concrete job, one tap each. A label, not a category
// the system knows about: the crew can rename any of them, and a breakdown that
// needs "Rebar" as its own line just types it.
export const BREAKDOWN_PRESETS = ["Materials", "Labor", "Equipment", "Permits", "Hauling & disposal"] as const;

/**
 * Who this builder is showing.
 *
 *   breakdown  the lines that make up the price. Always included, so there is
 *              no "let them say no" switch - a refusable line is an extra, and
 *              extras have their own section.
 *   extras     the optional add-ons the customer answers yes or no to.
 *   all        both, in one list. The locked record of an answered quote, and
 *              any caller that has not been split yet.
 *
 * All three edit the SAME rows array, filtered for display. There is one list
 * of lines on a quote, one place it is saved, and one total it adds up to; the
 * two sections are two views of it, never two copies that can disagree.
 */
export type BuilderMode = "breakdown" | "extras" | "all";

export function OptionBuilder({
  rows,
  onChange,
  labels,
  locked,
  answers,
  mode = "all",
  target,
  choiceActive = false,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
  labels: OptionLabels;
  mode?: BuilderMode;
  /**
   * The price the customer is already holding, when there is one. A crew
   * breaking an existing quote down into materials and labor usually wants the
   * lines to land on the figure the customer has seen, so the gap is shown as
   * they type rather than discovered on the customer's phone.
   */
  target?: number | null;
  /** Two prices are on offer, so required lines sit on top of either one. */
  choiceActive?: boolean;
  // The customer has answered. The rows are the record of what they bought, so
  // they are shown and not edited.
  locked?: boolean;
  // Their answer per stored row, for that locked view.
  answers?: Record<string, "accepted" | "declined" | null>;
}) {
  const t = labels;
  const total = rowsTotal(rows);
  // The rows this view owns. Everything below reads `shown`; every write goes
  // back through the full array so the other section's rows are never touched.
  const owns = (r: OptionRow) => (mode === "breakdown" ? r.required : mode === "extras" ? !r.required : true);
  const shown = rows.filter(owns);
  const shownTotal = rowsTotal(shown);

  const set = (key: string, patch: Partial<OptionRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const add = (required: boolean, title = "") => onChange([...rows, { ...blankRow(required), title }]);
  // Up and down within THIS section: swaps with the nearest row of the same
  // kind, so moving a breakdown line never hops it over an extra.
  const move = (key: string, by: -1 | 1) => {
    const order = rows.map((r, i) => ({ r, i })).filter(({ r }) => owns(r));
    const at = order.findIndex(({ r }) => r.key === key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= order.length) return;
    const next = [...rows];
    const i = order[at].i;
    const j = order[to].i;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  if (locked) {
    if (rows.length === 0) return null;
    const boughtTotal = rowsTotal(rows.filter((r) => (r.id ? answers?.[r.id] : null) === "accepted"));
    return (
      <fieldset className="qo-box">
        <legend>{t.title}</legend>
        <p className="crm-muted crm-sm">{t.lockedNote}</p>
        <ul className="qo-locked">
          {rows.map((r) => {
            const answer = r.id ? answers?.[r.id] : null;
            return (
              <li key={r.key} className={answer === "declined" ? "qo-locked-no" : "qo-locked-yes"}>
                <span className="qo-locked-title">{r.title}</span>
                <span className="qo-locked-amount">{usd(rowAmount(r))}</span>
                <span className="qo-tag">
                  {answer === "accepted" ? t.answerYes : answer === "declined" ? t.answerNo : t.answerNone}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="qo-total">
          <span>{t.acceptedTotal}</span>
          <strong>{usd(boughtTotal)}</strong>
        </p>
      </fieldset>
    );
  }

  const split = mode !== "all";
  const legend =
    mode === "breakdown"
      ? choiceActive
        ? t.breakdownChoiceTitle
        : t.breakdownTitle
      : mode === "extras"
        ? t.extrasTitle
        : t.title;
  const lead =
    mode === "breakdown" && choiceActive
      ? t.breakdownChoiceHint
      : mode === "breakdown"
      ? shown.length === 0
        ? t.breakdownEmpty
        : t.breakdownHint
      : mode === "extras"
        ? t.extrasHint
        : rows.length === 0
          ? t.emptyHint
          : t.hint;
  // What is left to put on a line, against the price the customer already has.
  const gap =
    mode === "breakdown" && !choiceActive && target != null && target > 0 && shown.length > 0
      ? Math.round((target - shownTotal) * 100) / 100
      : null;

  return (
    <fieldset className={`qo-box${split ? ` qo-box-${mode}` : ""}`}>
      <legend>{legend}</legend>
      <p className="crm-muted crm-sm">{lead}</p>

      {shown.map((r, i) => (
        <div key={r.key} className={`qo-row${r.required ? " qo-row-required" : ""}`}>
          <div className="qo-row-head">
            {/* In a split view the section heading already says what kind of
                line this is; a tag on every row would just repeat it. */}
            {!split && (
              <span className={`qo-kind qo-kind-${r.required ? "required" : "optional"}`}>
                {r.required ? t.kindRequired : t.kindOptional}
              </span>
            )}
            <div className="qo-row-tools">
              {/* The order the customer reads them in. Worth controlling: the
                  thing they asked for goes first, the extra second. */}
              <button type="button" onClick={() => move(r.key, -1)} disabled={i === 0} aria-label={t.moveUp}>
                &uarr;
              </button>
              <button
                type="button"
                onClick={() => move(r.key, 1)}
                disabled={i === shown.length - 1}
                aria-label={t.moveDown}
              >
                &darr;
              </button>
              <button type="button" className="qo-remove" onClick={() => remove(r.key)}>
                {t.remove}
              </button>
            </div>
          </div>

          <div className="qo-row-main">
            <label className="qo-field qo-field-title">
              <span>{t.itemTitle}</span>
              <input
                value={r.title}
                onChange={(e) => set(r.key, { title: e.target.value })}
                maxLength={OPTION_TITLE_MAX}
                placeholder={mode === "breakdown" ? t.breakdownLinePlaceholder : t.itemTitlePlaceholder}
              />
            </label>
            <label className="qo-field qo-field-price">
              <span>{t.itemPrice}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={r.amount}
                onChange={(e) => set(r.key, { amount: e.target.value })}
                placeholder="0"
              />
            </label>
          </div>

          <label className="qo-field">
            <span>{t.itemDesc}</span>
            <AutoTextarea
              rows={2}
              value={r.description}
              onChange={(e) => set(r.key, { description: e.target.value })}
              placeholder={mode === "breakdown" ? t.breakdownDescPlaceholder : t.itemDescPlaceholder}
              maxLength={2000}
            />
          </label>

          {/* One switch, worded as what it actually decides. "Required" on its
              own reads as a form validation rule rather than as the thing it
              is: whether the customer is allowed to say no to this. Only in the
              combined view: when the sections are split, which section a line
              is in IS the answer, and moving it means adding it to the other. */}
          {!split && (
            <>
              <label className="qo-toggle">
                <input
                  type="checkbox"
                  checked={!r.required}
                  onChange={(e) => set(r.key, { required: !e.target.checked })}
                />
                <span>{t.letThemChoose}</span>
              </label>
              <p className="crm-muted crm-sm qo-kind-hint">{r.required ? t.requiredHint : t.optionalHint}</p>
            </>
          )}
        </div>
      ))}

      {rows.length < MAX_QUOTE_OPTIONS &&
        (mode === "breakdown" ? (
          <div className="qo-add">
            {/* The usual parts of a concrete job, one tap each, then a blank line
                for anything else. Presets already on the quote drop out, so the
                row reads as "what's left to add". */}
            <div className="qo-presets">
              {BREAKDOWN_PRESETS.filter((name) => !shown.some((r) => r.title.trim() === name)).map((name) => (
                <button key={name} type="button" className="qo-preset" onClick={() => add(true, name)}>
                  + {name}
                </button>
              ))}
            </div>
            <button type="button" className="qo-add-btn" onClick={() => add(true)}>
              {t.addRequired}
            </button>
          </div>
        ) : mode === "extras" ? (
          <div className="qo-add">
            <button type="button" className="qo-add-btn" onClick={() => add(false)}>
              {t.addOptional}
            </button>
          </div>
        ) : (
          <div className="qo-add">
            {/* A line of the job first: breaking the price down is the common
                ask, and an extra the customer can refuse is the special case. */}
            <button type="button" className="qo-add-btn" onClick={() => add(true)}>
              {t.addRequired}
            </button>
            <button type="button" className="qo-add-btn" onClick={() => add(rows.length === 0)}>
              {t.addOptional}
            </button>
          </div>
        ))}

      {mode === "breakdown" && shown.length > 0 && (
        <>
          <p className="qo-total">
            <span>{t.total}</span>
            <strong>{usd(shownTotal)}</strong>
          </p>
          {/* Against the price they already have. Said in plain money, both
              directions, so "make it add up to what we quoted" is a matter of
              reading one line rather than doing sums on a phone. */}
          {gap != null && gap !== 0 && (
            <p className={`qo-gap${gap < 0 ? " qo-gap-over" : ""}`}>
              {(gap > 0 ? t.breakdownUnder : t.breakdownOver)
                .replace("{quoted}", usd(target as number))
                .replace("{diff}", usd(Math.abs(gap)))}
            </p>
          )}
          {gap === 0 && <p className="qo-gap qo-gap-even">{t.breakdownMatches.replace("{quoted}", usd(target as number))}</p>}
        </>
      )}
      {mode === "extras" && shown.length > 0 && (
        <p className="qo-total qo-total-quiet">
          <span>{t.extrasTotal}</span>
          <strong>{usd(shownTotal)}</strong>
        </p>
      )}
      {mode === "all" && rows.length > 0 && (
        <p className="qo-total">
          <span>{rows.some((r) => !r.required) ? t.allInTotal : t.total}</span>
          <strong>{usd(total)}</strong>
        </p>
      )}
    </fieldset>
  );
}

/**
 * The second section of a quote's pricing: optional extras and pricing the job
 * two ways, folded away under one heading.
 *
 * Most quotes are a price and a breakdown, and these are a paragraph each of
 * reading to scroll past on the way to Send. Folded, they are one line. It
 * opens by itself when the quote already uses either, so nobody editing an
 * extra has to hunt for it - and stays however the person left it after that.
 */
export function MoreWaysToPrice({
  labels,
  startOpen,
  children,
}: {
  labels: OptionLabels;
  startOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <details className="qo-more" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="qo-more-title">{labels.moreTitle}</span>
        <span className="qo-more-hint">{labels.moreHint}</span>
      </summary>
      <div className="qo-more-body">{children}</div>
    </details>
  );
}
