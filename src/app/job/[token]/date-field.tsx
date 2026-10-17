"use client";

import { useState } from "react";

import { dict, fill, longDay, type Locale } from "@/lib/crm/i18n";

// A native date input orders its fields by the phone's locale (D/M/Y vs M/D/Y) without saying so, and a
// swapped day/month is still valid (9/1 books Jan 9). So the picked day is spelled out underneath, and a
// past day says so in words. `min` stays as the hard stop.
export function DateField({
  name,
  minDate,
  locale,
  defaultValue = "",
  className,
}: {
  name: string;
  minDate: string;
  locale: Locale;
  defaultValue?: string;
  className?: string;
}) {
  const t = dict(locale);
  const [value, setValue] = useState(defaultValue);
  // Spanish keeps weekdays lowercase mid-sentence; only a sentence-opening date is capitalised.
  const opener = (ymd: string) => {
    const s = longDay(ymd, locale);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // YYYY-MM-DD, so string compare is date compare. A half-typed date reads as "".
  const tooEarly = value !== "" && value < minDate;

  return (
    <div className="jd">
      <input
        type="date"
        name={name}
        className={className}
        min={minDate}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      {value !== "" && (
        <p className={tooEarly ? "jd-echo jd-echo-bad" : "jd-echo"}>
          {tooEarly
            ? fill(t.contractorJob.dateTooEarly, { picked: opener(value), min: longDay(minDate, locale) })
            : opener(value)}
        </p>
      )}
    </div>
  );
}
