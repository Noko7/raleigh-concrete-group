"use client";

import {
  dollarsOrZero as usd,
  isChoice,
  MAX_QUOTE_PACKAGES,
  PACKAGE_DESC_MAX,
  PACKAGE_TITLE_MAX,
  packageLetter,
} from "@/lib/crm/constants";
import type { dict } from "@/lib/crm/i18n";
import { SpellInput, SpellTextarea } from "@/components/spell-field";

// The "or instead" builder, shared by the CRM editor and the crew's job page.
// Mirrors OptionBuilder (controlled, JSON in a hidden input) since they sit on
// the same form. Not more line items: two chosen line items is a bigger job,
// two chosen packages a contradiction, so the customer picks exactly one.
export type PackageLabels = ReturnType<typeof dict>["quotePackages"];

// A card being edited. `key` is client-side identity for cards with no DB id;
// `id` is the stored row, and keeping it preserves the customer's choice.
export type PackageRow = {
  key: string;
  id?: string;
  title: string;
  description: string;
  // A string: while typing, empty and zero differ, and only zero is a price.
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

// Pick-ONE extras rewritten as a choice. "Section 1 / 2 / 3 / All sections" as
// optional extras let a customer accept all four and be priced twice over.
export function packagesFromOptionRows(rows: { title: string; description: string; amount: string }[]): PackageRow[] {
  return rows
    .filter((r) => r.title.trim() !== "")
    .map((r) => ({ ...blankPackage(), title: r.title, description: r.description, amount: r.amount }));
}

export const packageAmountOf = (r: PackageRow): number => {
  const n = Number(r.amount);
  return Number.isFinite(n) ? n : 0;
};

// Blank cards are dropped rather than refused.
export const filledPackages = (rows: PackageRow[]) => rows.filter((r) => r.title.trim() !== "");

// A lone card isn't a choice: kept on save (half-written), but it prices nothing
// and the customer never sees it. The server applies the same rule.
export const offersChoice = (rows: PackageRow[]): boolean => isChoice(filledPackages(rows));

// The marked card, else the first: the headline figure for a choice quote,
// which has no single price.
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

// Same choice? Used by both editors to tell a correction from a re-send.
export function packagesMatch(a: PackageRow[], b: PackageRow[]): boolean {
  const norm = (rows: PackageRow[]) =>
    filledPackages(rows).map(
      (r) => `${r.title.trim()}|${r.description.trim()}|${packageAmountOf(r)}|${r.recommended}`,
    );
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

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
  // The customer has chosen: the cards are the record, so read-only.
  locked?: boolean;
  // Their answer per stored card, for the locked view.
  answers?: Record<string, "accepted" | "declined" | null>;
}) {
  const t = labels;

  const set = (key: string, patch: Partial<PackageRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  // The first press makes two cards: a choice needs two sides.
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
  // At most one recommendation (the DB enforces it too); picking one un-picks
  // the other instead of failing the save.
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

  // Empty state, which almost every quote stays in: one line tall.
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
              <SpellInput
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
            <SpellTextarea
              rows={2}
              value={r.description}
              onChange={(e) => set(r.key, { description: e.target.value })}
              placeholder={t.itemDescPlaceholder}
              maxLength={PACKAGE_DESC_MAX}
            />
          </label>

          {/* "Which would you pick?" Optional; only one card can carry it. */}
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

      {/* Says before Send that one card isn't yet a choice, rather than the
          customer's page revealing it. */}
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
