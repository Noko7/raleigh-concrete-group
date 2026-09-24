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

// The pieces of a quote form that the customer will read back: the price, the
// five sections, and a preview of the page they open. Shared by the crew's form
// on /job/<token> and the owner's editor in the CRM, so a quote written in a
// truck and one written at a desk look the same while they are being written
// and send the same thing. Each form keeps its own state and its own submit;
// these only draw.

export type Sections = Record<QuoteSectionField, string>;

export const emptySections = (): Sections =>
  Object.fromEntries(QUOTE_SECTION_FIELDS.map((f) => [f, ""])) as Sections;

// What the Not applicable button writes. The customer's page reads it back and
// shows it quieter than the sections that are real work.
export const NOT_APPLICABLE = "Not applicable";

export function blankSections(sections: Sections): QuoteSectionField[] {
  return QUOTE_SECTION_FIELDS.filter((f) => !sections[f].trim());
}

/**
 * The price, set the way the customer will see it: one big number in the same
 * outlined card their quote page opens on. Read-only when line items or a
 * choice of options work it out instead.
 */
export function PriceCard({
  value,
  onChange,
  derived,
  derivedLabel = "Total, worked out from the options below",
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

/**
 * The five sections on the timeline the customer reads them on. A stop fills
 * in once its section has something in it, so what's left reads straight down.
 */
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
 * The customer's page, built from what is in the fields right now with the
 * component that page itself uses. Closed until asked for: the form already
 * reads like it, this is the final check.
 */
export function CustomerPreview({
  firstName,
  price,
  derived,
  sections,
  startOpen = false,
}: {
  firstName: string;
  price: number | null;
  derived: boolean;
  sections: Sections;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const filled = QUOTE_SECTION_FIELDS.filter((f) => sections[f].trim());
  return (
    <>
      <button type="button" className="jq-preview-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide preview" : `See what ${firstName} sees`}
      </button>
      {open && (
        <div className="jq-preview">
          <p className="jq-preview-note">This is how it shows on {firstName}&apos;s phone.</p>
          <p className="cq-title">Hi {firstName},</p>
          <div className="cq-price">
            <span className="cq-price-label">{derived ? "Your total" : "Your price, all in"}</span>
            <span className="cq-price-value">{price != null && price > 0 ? dollars(price) : "-"}</span>
            <span className="cq-price-sub">Free quote · no obligation until you approve</span>
          </div>
          {filled.length > 0 && (
            <div className="cq-summary">
              <h2>What&apos;s included</h2>
              <QuoteSections sections={filled.map((f) => [QUOTE_SECTION_LABELS[f], sections[f]] as const)} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
