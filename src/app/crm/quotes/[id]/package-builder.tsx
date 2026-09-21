"use client";

import {
  dollars,
  isChoice,
  MAX_QUOTE_PACKAGES,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  packageLetter,
} from "@/lib/crm/constants";
import type { dict } from "@/lib/crm/i18n";

// The "or instead" builder, shared by the CRM editor and the crew's job page so
// a quote written from a truck can offer the same choice as one written at a
// desk. Sibling of OptionBuilder in every way that matters - controlled, parent
// owns the rows, same JSON-in-a-hidden-input hand-off - because the two sit one
// above the other on the same form and any difference between them would read
// as a bug.
//
// What it is NOT is more line items. Two line items both chosen is a bigger
// job; two of these both chosen is a contradiction, which is why they are their
// own list with their own table and the customer picks exactly one.
export type PackageLabels = ReturnType<typeof dict>["quotePackages"];

// A card being edited. `key` is a client-side identity so React can track a
// card that has no database id yet; `id` is the stored row it came from, and
// keeping it is what preserves the customer's choice across an edit.
export type PackageRow = {
  key: string;
  id?: string;
  title: string;
  description: string;
  // Held as a string, not a number: an empty box and a zero are different
  // things while somebody is typing, and only one of them is a price.
  amount: string;
  recommended: boolean;
};

export type StoredPackage = {
  id: string;
  title: string;
  description: string | null;
  amount: number;
  recommended: boolean;
  customer_response: "accepted" | "declined" | null;
};

let seq = 0;
const nextKey = () => `pkg-${++seq}`;

export function rowsFromPackages(packages: StoredPackage[]): PackageRow[] {
  return packages.map((p) => ({
    key: nextKey(),
    id: p.id,
    title: p.title,
    description: p.description ?? "",
    amount: String(p.amount),
    recommended: p.recommended,
  }));
}

export function blankPackage(): PackageRow {
  return { key: nextKey(), id: undefined, title: "", description: "", amount: "", recommended: false };
}

export const packageAmountOf = (r: PackageRow): number => {
  const n = Number(r.amount);
  return Number.isFinite(n) ? n : 0;
};

// Blank cards are dropped rather than refused: adding one and thinking better
// of it is not a mistake anybody should have to go back and clear.
export const filledPackages = (rows: PackageRow[]) => rows.filter((r) => r.title.trim() !== "");

// One way of doing the job is not a choice. A lone card is kept on save - it is
// somebody halfway through writing the second one - but it prices nothing and
// the customer is never shown it, and the same rule runs on the server.
export const offersChoice = (rows: PackageRow[]): boolean => isChoice(filledPackages(rows));

// The one the contractor marked, else the first. The headline figure on a quote
// that offers a choice is built from this, because there is no single price on
// such a quote and the lead option is the most honest stand-in for one.
export function leadPackageRow(rows: PackageRow[]): PackageRow | null {
  const filled = filledPackages(rows);
  return filled.find((r) => r.recommended) ?? filled[0] ?? null;
}

export const leadPackageAmount = (rows: PackageRow[]): number => {
  const lead = leadPackageRow(rows);
  return lead ? packageAmountOf(lead) : 0;
};

// What the server action reads out of `packages_json`.
export const packagesToJson = (rows: PackageRow[]): string =>
  JSON.stringify(
    filledPackages(rows).map((r) => ({
      id: r.id,
      title: r.title.trim(),
      description: r.description.trim(),
      amount: packageAmountOf(r),
      recommended: r.recommended,
    })),
  );

// Two lists describe the same choice. Used by both editors to tell a correction
// apart from a re-send of the same quote.
export function packagesMatch(a: PackageRow[], b: PackageRow[]): boolean {
  const norm = (rows: PackageRow[]) =>
    filledPackages(rows).map(
      (r) => `${r.title.trim()}|${r.description.trim()}|${packageAmountOf(r)}|${r.recommended}`,
    );
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const usd = (n: number) => dollars(n) ?? "$0";

export function PackageBuilder({
  rows,
  onChange,
  labels,
  locked,
  answers,
}: {
  rows: PackageRow[];
  onChange: (rows: PackageRow[]) => void;
  labels: PackageLabels;
  // The customer has chosen. The cards are the record of what they were offered
  // and what they took, so they are shown and not edited.
  locked?: boolean;
  // Their answer per stored card, for that locked view.
  answers?: Record<string, "accepted" | "declined" | null>;
}) {
  const t = labels;

  const set = (key: string, patch: Partial<PackageRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  // A choice needs two sides, so the first press makes both. Adding one card and
  // being told it isn't enough yet is a worse first minute than starting with
  // the shape of the thing you are about to write.
  const start = () => onChange([blankPackage(), blankPackage()]);
  const add = () => onChange([...rows, blankPackage()]);
  const move = (key: string, by: -1 | 1) => {
    const i = rows.findIndex((r) => r.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  // At most one recommendation per quote - two is no recommendation, and the
  // database says so too. Picking a new one un-picks the old rather than
  // failing a save the person has no way to understand.
  const recommend = (key: string, on: boolean) =>
    onChange(rows.map((r) => ({ ...r, recommended: on ? r.key === key : r.recommended && r.key !== key })));

  if (locked) {
    if (rows.length === 0) return null;
    return (
      <fieldset className="qc-box">
        <legend>{t.title}</legend>
        <p className="crm-muted crm-sm">{t.lockedNote}</p>
        <ul className="qc-locked">
          {rows.map((r) => {
            const answer = r.id ? answers?.[r.id] : null;
            return (
              <li key={r.key} className={answer === "accepted" ? "qc-locked-yes" : "qc-locked-no"}>
                <span className="qc-locked-title">{r.title}</span>
                <span className="qc-locked-amount">{usd(packageAmountOf(r))}</span>
                <span className="qc-tag">{answer === "accepted" ? t.answerPicked : t.answerNotPicked}</span>
              </li>
            );
          })}
        </ul>
      </fieldset>
    );
  }

  // Nothing yet: one button and a sentence saying what it is for. The empty
  // state is the state almost every quote stays in, so it stays one line tall.
  if (rows.length === 0) {
    return (
      <fieldset className="qc-box qc-box-empty">
        <legend>{t.title}</legend>
        <p className="crm-muted crm-sm">{t.emptyHint}</p>
        <button type="button" className="qc-start" onClick={start}>
          {t.start}
        </button>
      </fieldset>
    );
  }

  const filled = filledPackages(rows);
  const lead = leadPackageRow(rows);

  return (
    <fieldset className="qc-box">
      <legend>{t.title}</legend>
      <p className="crm-muted crm-sm">{t.hint}</p>

      {rows.map((r, i) => (
        <div key={r.key} className={`qc-card${r.recommended ? " qc-card-rec" : ""}`}>
          <div className="qc-card-head">
            <span className="qc-letter">{`${t.optionWord} ${packageLetter(i)}`}</span>
            <div className="qc-card-tools">
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
              <button type="button" className="qc-remove" onClick={() => remove(r.key)}>
                {t.remove}
              </button>
            </div>
          </div>

          <div className="qc-card-main">
            <label className="qo-field qo-field-title">
              <span>{t.itemTitle}</span>
              <input
                value={r.title}
                onChange={(e) => set(r.key, { title: e.target.value })}
                maxLength={PACKAGE_TITLE_MAX}
                placeholder={i === 0 ? t.itemTitlePlaceholderA : t.itemTitlePlaceholderB}
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
              maxLength={PACKAGE_DESC_MAX}
            />
          </label>

          {/* The one thing a customer staring at two prices actually wants:
              which would you pick. Optional, and only one card can carry it. */}
          <label className="qc-rec">
            <input
              type="checkbox"
              checked={r.recommended}
              onChange={(e) => recommend(r.key, e.target.checked)}
            />
            <span>{t.recommend}</span>
          </label>
        </div>
      ))}

      {rows.length < MAX_QUOTE_PACKAGES && (
        <div className="qo-add">
          <button type="button" className="qo-add-btn" onClick={add}>
            {t.addAnother}
          </button>
        </div>
      )}

      {/* Says where the quote stands before anybody presses Send. One card is
          saved and kept, but it is not yet a choice, and finding that out from
          the customer's page would be finding it out far too late. */}
      {filled.length < 2 ? (
        <p className="qc-warn">{t.needTwo}</p>
      ) : (
        <p className="qc-lead-note">
          {t.leadNote}
          <strong>{` ${lead?.title.trim() || "-"} · ${usd(lead ? packageAmountOf(lead) : 0)}`}</strong>
        </p>
      )}
    </fieldset>
  );
}
