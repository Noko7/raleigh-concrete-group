"use client";

import { useState } from "react";

import { AutoTextarea } from "@/components/auto-textarea";
import { QuoteSections } from "@/components/quote-sections";
import {
  dollars,
  QUOTE_SECTION_FIELDS,
  QUOTE_SECTION_HINTS,
  QUOTE_SECTION_LABELS,
  type QuoteSectionField,
} from "@/lib/crm/constants";

// Quote form pieces the customer reads back, shared by the crew's /job/<token> form and the owner's CRM
// editor so both write and send the same thing. Each form keeps its own state and submit; these only draw.

export type Sections = Record<QuoteSectionField, string>;

export const emptySections = (): Sections =>
  Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, ""])) as Sections;

// The customer's page shows this quieter than real sections.
export const NOT_APPLICABLE = "Not applicable";

export function blankSections(sections: Sections): QuoteSectionField[] {
  return QUOTE_SECTION_FIELDS.filter((f) => !sections[f].trim());
}

/** Styled as on the customer's quote page. Read-only when line items or packages derive it. */
export function PriceCard({
  value,
  onChange,
  derived,
  derivedLabel = "Total, from the price breakdown below",
}: {
  value: string;
  onChange: (v: string) => void;
  derived: boolean;
  derivedLabel?: string;
}) {
  return (
    <label className="jq-price">
      <span className="jq-price-label">{derived ? derivedLabel : "Price, all in"}</span>
      <span className="jq-price-row">
        <span className="jq-price-sign" aria-hidden="true">
          $
        </span>
        <input
          type="number"
          name="quote_amount"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="6500"
          readOnly={derived}
          aria-label="Price in dollars"
        />
      </span>
    </label>
  );
}

/** A stop fills in once its section has content, so what's left reads straight down. */
export function SectionsEditor({
  sections,
  onChange,
  idPrefix = "jq",
}: {
  sections: Sections;
  onChange: (field: QuoteSectionField, value: string) => void;
  idPrefix?: string;
}) {
  const done = QUOTE_SECTION_FIELDS.length - blankSections(sections).length;
  return (
    <div className="jq-included">
      <div className="jq-included-head">
        <h3>What&apos;s included</h3>
        <span className={done === QUOTE_SECTION_FIELDS.length ? "jq-count jq-count-done" : "jq-count"}>
          {done} of {QUOTE_SECTION_FIELDS.length} done
        </span>
      </div>
      <ol className="jq-steps">
        {QUOTE_SECTION_FIELDS.map((field) => {
          const filled = sections[field].trim() !== "";
          const id = `${idPrefix}-${field}`;
          return (
            <li key={field} className={filled ? "jq-step jq-step-done" : "jq-step"}>
              <div className="jq-step-head">
                <label htmlFor={id}>{QUOTE_SECTION_LABELS[field]}</label>
                {!filled && (
                  <button type="button" className="jq-na" onClick={() => onChange(field, NOT_APPLICABLE)}>
                    Not applicable
                  </button>
                )}
              </div>
              <AutoTextarea
                id={id}
                name={field}
                rows={2}
                value={sections[field]}
                onChange={(e) => onChange(field, e.target.value)}
                placeholder={QUOTE_SECTION_HINTS[field]}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Shown when every line item is optional and no choice exists (the "Section 1 / Section 2 / All" shape):
 * one tap rewrites them as a pick-one choice.
 */
export function PickOneSuggestion({
  rows,
  hasChoice,
  onConvert,
}: {
  rows: { title: string; amount: string; required: boolean }[];
  hasChoice: boolean;
  onConvert: () => void;
}) {
  const filled = rows.filter((r) => r.title.trim());
  if (hasChoice || filled.length < 2 || filled.some((r) => r.required)) return null;
  const sum = filled.reduce((n, r) => n + (Number(r.amount) || 0), 0);
  return (
    <div className="jq-pickone" role="note">
      <p>
        <strong>Should they pick just one of these?</strong> Right now the customer can say yes to every line, and
        their total adds them all up ({dollars(sum)} if they take everything).
      </p>
      <button type="button" className="jq-pickone-btn" onClick={onConvert}>
        Make it pick one
      </button>
    </div>
  );
}

/** The customer's page built from the current fields with that page's own component. Closed by default. */
export type PreviewLine = { title: string; amount: number; description?: string };

export function CustomerPreview({
  firstName,
  price,
  derived,
  sections,
  startOpen = false,
  lines = [],
  extras = 0,
  choice = false,
}: {
  firstName: string;
  price: number | null;
  derived: boolean;
  sections: Sections;
  startOpen?: boolean;
  /** Every line that is part of the job. */
  lines?: PreviewLine[];
  /** How many optional extras the customer will be asked about. */
  extras?: number;
  /** Priced two ways: the customer picks one first. */
  choice?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const filled = QUOTE_SECTION_FIELDS.filter((f) => sections[f].trim());
  // Matches the customer page: scope, each line with its price, then the total.
  const breakdown = !choice && lines.length > 0;
  const breakdownTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  return (
    <>
      <button type="button" className="jq-preview-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide preview" : `See what ${firstName} sees`}
      </button>
      {open && (
        <div className="jq-preview">
          <p className="jq-preview-note">This is how it shows on {firstName}&apos;s phone.</p>
          <p className="cq-title">Hi {firstName},</p>
          {/* A broken-down quote has no price card on the customer page (its total sits under the lines). */}
          {!breakdown && (
            <div className="cq-price">
              <span className="cq-price-label">{derived ? "Your total" : "Your price, all in"}</span>
              {/* No total until the customer picks, same as the customer page. */}
              <span className="cq-price-value">{!derived && price != null && price > 0 ? dollars(price) : "-"}</span>
              <span className="cq-price-sub">
                {derived ? "Shown once they pick their options" : "Free quote · no obligation until you approve"}
              </span>
            </div>
          )}
          {filled.length > 0 && (
            <div className="cq-summary">
              <h2>What&apos;s included</h2>
              <QuoteSections sections={filled.map((f) => [QUOTE_SECTION_LABELS[f], sections[f]] as const)} />
            </div>
          )}
          {breakdown && (
            <div className="jq-preview-breakdown">
              <h2 className="cq-opts-title">Price breakdown</h2>
              <ul className="cq-opt-list cq-breakdown">
                {lines.map((l, i) => (
                  <li key={i} className="cq-opt cq-opt-on">
                    <div className="cq-opt-head">
                      <span className="cq-opt-title">{l.title}</span>
                      <span className="cq-opt-price">{dollars(l.amount) ?? "$0"}</span>
                    </div>
                    {l.description && <p className="cq-opt-desc">{l.description}</p>}
                  </li>
                ))}
              </ul>
              {extras > 0 && (
                <p className="cq-fine">
                  Then {extras === 1 ? "1 optional extra" : `${extras} optional extras`} they can say yes or no to.
                </p>
              )}
              <div className="cq-opt-total">
                <span>Your total</span>
                <strong>{dollars(breakdownTotal) ?? "$0"}</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
