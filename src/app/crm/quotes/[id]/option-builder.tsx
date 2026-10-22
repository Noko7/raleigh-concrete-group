"use client";

import { useState, type ReactNode } from "react";

import { dollarsOrZero as usd, MAX_QUOTE_OPTIONS, OPTION_TITLE_MAX } from "@/lib/crm/constants";
import type { dict } from "@/lib/crm/i18n";
import { SpellInput, SpellTextarea } from "@/components/spell-field";

// The line-item builder, shared by the CRM editor and the crew's job page.
// Controlled: the parent owns the rows, since it also needs the total and the
// JSON for the action's hidden input.
export type OptionLabels = ReturnType<typeof dict>["quoteOptions"];

// A row being edited. `key` is client-side identity for rows with no DB id yet;
// `id` is the stored row, and keeping it preserves the customer's answer.
export type OptionRow = {
  key: string;
  id?: string;
  title: string;
  description: string;
  // A string: while typing, empty and zero differ, and only zero is a price.
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

// Blank rows are dropped rather than refused.
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

// The breakdown lines exactly as saved (blanks dropped, same rounding) and the
// count of extras, for the customer preview. Shared so all three previews agree.
export function previewOf(rows: OptionRow[]) {
  const filled = filledRows(rows);
  return {
    lines: filled
      .filter((r) => r.required)
      .map((r) => ({ title: r.title.trim(), amount: rowAmount(r), description: r.description.trim() || undefined })),
    extras: filled.filter((r) => !r.required).length,
  };
}

// Same offer? Used by both editors to tell a correction from a re-send.
export function rowsMatch(a: OptionRow[], b: OptionRow[]): boolean {
  const norm = (rows: OptionRow[]) =>
    filledRows(rows).map((r) => `${r.title.trim()}|${r.description.trim()}|${rowAmount(r)}|${r.required}`);
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Common parts of a concrete job, one tap each. Just labels: the crew can rename them.
export const BREAKDOWN_PRESETS = ["Materials", "Labor", "Equipment", "Permits", "Hauling & disposal"] as const;

/**
 * What this builder shows:
 *
 *   breakdown  lines that make up the price; always included (a refusable
 *              line is an extra)
 *   extras     optional add-ons the customer answers yes/no
 *   all        both in one list: an answered quote's locked record, and any
 *              caller not yet split
 *
 * All three edit the SAME rows array, filtered for display, so the sections
 * can never disagree.
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
   * The price the customer already holds, if any, so the gap is shown while
   * breaking it down rather than found on the customer's phone.
   */
  target?: number | null;
  /** A choice is on offer, so required lines sit on top of either option. */
  choiceActive?: boolean;
  // Answered: the rows are the record of what they bought, so read-only.
  locked?: boolean;
  // Their answer per stored row, for the locked view.
  answers?: Record<string, "accepted" | "declined" | null>;
}) {
  const t = labels;
  const total = rowsTotal(rows);
  // Rows this view owns. Writes go through the full array so the other
  // section's rows are untouched.
  const owns = (r: OptionRow) => (mode === "breakdown" ? r.required : mode === "extras" ? !r.required : true);
  const shown = rows.filter(owns);
  const shownTotal = rowsTotal(shown);

  const set = (key: string, patch: Partial<OptionRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const add = (required: boolean, title = "") => onChange([...rows, { ...blankRow(required), title }]);
  // Moves swap with the nearest row of the same kind, so a breakdown line never
  // hops over an extra.
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
  // What's left to allocate against the customer's existing price.
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
            {/* In a split view the heading already says the kind. */}
            {!split && (
              <span className={`qo-kind qo-kind-${r.required ? "required" : "optional"}`}>
                {r.required ? t.kindRequired : t.kindOptional}
              </span>
            )}
            <div className="qo-row-tools">
              {/* The customer's reading order: what they asked for first. */}
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
              <SpellInput
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
            <SpellTextarea
              rows={2}
              value={r.description}
              onChange={(e) => set(r.key, { description: e.target.value })}
              placeholder={mode === "breakdown" ? t.breakdownDescPlaceholder : t.itemDescPlaceholder}
              maxLength={2000}
            />
          </label>

          {/* Worded as what it decides (can the customer say no?); "Required"
              reads like validation. Combined view only: split, the section is
              the answer. */}
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
            {/* Presets then a blank line; presets already used drop out. */}
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
            {/* A job line first: breakdowns are common, refusable extras special. */}
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
          {/* The gap in plain money, either direction, so matching the quote is
              reading one line, not doing sums. */}
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
 * Second pricing section: optional extras and pricing two ways, folded under
 * one heading since most quotes don't use them. Opens by itself when the quote
 * already uses either, then stays as the user left it.
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
