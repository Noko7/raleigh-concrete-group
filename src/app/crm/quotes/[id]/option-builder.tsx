"use client";

import { MAX_QUOTE_OPTIONS, OPTION_TITLE_MAX } from "@/lib/crm/constants";
import type { dict } from "@/lib/crm/i18n";

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

// Two lists describe the same offer. Used by both editors to tell a correction
// apart from a re-send of the same quote.
export function rowsMatch(a: OptionRow[], b: OptionRow[]): boolean {
  const norm = (rows: OptionRow[]) =>
    filledRows(rows).map((r) => `${r.title.trim()}|${r.description.trim()}|${rowAmount(r)}|${r.required}`);
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function OptionBuilder({
  rows,
  onChange,
  labels,
  locked,
  answers,
}: {
  rows: OptionRow[];
  onChange: (rows: OptionRow[]) => void;
  labels: OptionLabels;
  // The customer has answered. The rows are the record of what they bought, so
  // they are shown and not edited.
  locked?: boolean;
  // Their answer per stored row, for that locked view.
  answers?: Record<string, "accepted" | "declined" | null>;
}) {
  const t = labels;
  const total = rowsTotal(rows);

  const set = (key: string, patch: Partial<OptionRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const add = (required: boolean) => onChange([...rows, blankRow(required)]);
  const move = (key: string, by: -1 | 1) => {
    const i = rows.findIndex((r) => r.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const next = [...rows];
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

  return (
    <fieldset className="qo-box">
      <legend>{t.title}</legend>
      <p className="crm-muted crm-sm">{rows.length === 0 ? t.emptyHint : t.hint}</p>

      {rows.map((r, i) => (
        <div key={r.key} className={`qo-row${r.required ? " qo-row-required" : ""}`}>
          <div className="qo-row-head">
            <span className={`qo-kind qo-kind-${r.required ? "required" : "optional"}`}>
              {r.required ? t.kindRequired : t.kindOptional}
            </span>
            <div className="qo-row-tools">
              {/* The order the customer reads them in. Worth controlling: the
                  thing they asked for goes first, the extra second. */}
              <button type="button" onClick={() => move(r.key, -1)} disabled={i === 0} aria-label={t.moveUp}>
                &uarr;
              </button>
              <button
                type="button"
                onClick={() => move(r.key, 1)}
                disabled={i === rows.length - 1}
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
                placeholder={t.itemTitlePlaceholder}
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
            <textarea
              rows={2}
              value={r.description}
              onChange={(e) => set(r.key, { description: e.target.value })}
              placeholder={t.itemDescPlaceholder}
              maxLength={2000}
            />
          </label>

          {/* One switch, worded as what it actually decides. "Required" on its
              own reads as a form validation rule rather than as the thing it
              is: whether the customer is allowed to say no to this. */}
          <label className="qo-toggle">
            <input
              type="checkbox"
              checked={!r.required}
              onChange={(e) => set(r.key, { required: !e.target.checked })}
            />
            <span>{t.letThemChoose}</span>
          </label>
          <p className="crm-muted crm-sm qo-kind-hint">{r.required ? t.requiredHint : t.optionalHint}</p>
        </div>
      ))}

      {rows.length < MAX_QUOTE_OPTIONS && (
        <div className="qo-add">
          <button type="button" className="qo-add-btn" onClick={() => add(rows.length === 0)}>
            {t.addOptional}
          </button>
          <button type="button" className="qo-add-btn" onClick={() => add(true)}>
            {t.addRequired}
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <p className="qo-total">
          <span>{t.allInTotal}</span>
          <strong>{usd(total)}</strong>
        </p>
      )}
    </fieldset>
  );
}
