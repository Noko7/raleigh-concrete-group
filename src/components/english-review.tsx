"use client";

import { SpellTextarea } from "@/components/spell-field";
import { dict, fill, type Locale } from "@/lib/crm/i18n";

// The English a Spanish-mode writer's wording became, laid out field by field and editable, so the person
// who knows the job signs off on what the customer reads. English spell-check on, since this is the copy
// that goes out. Each form owns the values and what Send does with them; this only draws.
export type EnglishField = { key: string; label: string; short?: boolean };

export function EnglishReview({
  fields,
  values,
  onChange,
  customerFirstName,
  locale,
}: {
  fields: EnglishField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  customerFirstName: string;
  locale: Locale;
}) {
  const t = dict(locale).english;
  return (
    <div className="jq-english">
      <h3 className="jq-english-title">{fill(t.title, { name: customerFirstName })}</h3>
      <p className="js-hint">{t.lead}</p>
      {fields.map((f) => (
        <label key={f.key} className="jq-field">
          <span>{f.label}</span>
          <SpellTextarea
            rows={f.short ? 1 : 2}
            value={values[f.key] ?? ""}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
