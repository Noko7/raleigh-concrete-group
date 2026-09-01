"use client";

import { useState } from "react";

import { dict, fill, longDay, type Locale } from "@/lib/crm/i18n";

// Every date the crew picks on this page goes through here.
//
// A native date input takes its field order from the phone's own settings, so
// the same three boxes are D/M/Y for a contractor whose phone is in Spanish and
// M/D/Y for the next person's. Nothing on screen says which, and a day and
// month swapped round is still a perfectly valid date - just not the one they
// meant: 9/1 books January 9th instead of September 1st. The only thing that
// ever says otherwise is the browser's own bubble, which is in ISO ("el valor
// debe ser mayor o igual a 2026-09-01"), names a number nobody typed, and
// doesn't appear until they've already hit save.
//
// So the day being picked is spelled back out underneath in their own language
// as they type it, and a day that's already gone says so in words. `min` stays
// on the input as well: it greys the past out in the picker and is still the
// hard stop if they submit anyway.
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
  // Spanish keeps weekdays lowercase inside a sentence, so only the date that
  // opens one gets its first letter lifted.
  const opener = (ymd: string) => {
    const s = longDay(ymd, locale);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Both are YYYY-MM-DD, so a string compare is a date compare. A half-typed
  // date reads as "", which is neither past nor worth spelling out yet.
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
