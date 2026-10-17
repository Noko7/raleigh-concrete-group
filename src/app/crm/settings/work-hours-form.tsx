"use client";

import { useActionState, useState } from "react";

import {
  WEEKDAY_LABELS,
  WORK_HOUR_MAX,
  WORK_HOUR_MIN,
  hourSlot,
  slotsFor,
  type WorkHours,
} from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { saveWorkHours } from "./actions";
import type { SaveState } from "./types";

const initial: SaveState = { ok: true };

const DAY_NAMES: Record<Locale, string[]> = {
  en: WEEKDAY_LABELS,
};

const HOURS = Array.from({ length: WORK_HOUR_MAX - WORK_HOUR_MIN + 1 }, (_, i) => WORK_HOUR_MIN + i);

/**
 * A preference, not a rule: only decides which slots CUSTOMERS are offered on the public form. Contractors
 * booking from their job page can pick any time.
 */
export function WorkHoursForm({ hours, locale }: { hours: WorkHours; locale: Locale }) {
  const [state, formAction, pending] = useActionState(saveWorkHours, initial);
  const t = dict(locale);
  const [start, setStart] = useState(hours.startHour);
  const [end, setEnd] = useState(hours.endHour);
  const [days, setDays] = useState<number[]>(hours.days);

  const backwards = end < start;
  const noDays = days.length === 0;
  // Shown as the slots it produces, which two numbers and checkboxes don't convey.
  const preview = backwards ? [] : slotsFor({ startHour: start, endHour: end, days });
  const names = DAY_NAMES[locale] ?? WEEKDAY_LABELS;

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  return (
    <form action={formAction} className="crm-card crm-settings">
      <h2 className="crm-card-title">{t.settings.hoursTitle}</h2>
      <p className="crm-muted crm-sm">{t.settings.hoursHint}</p>

      <div className="wh-row">
        <label className="crm-field">
          <span>{t.settings.hoursFrom}</span>
          <select
            className="crm-input"
            name="work_start_hour"
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourSlot(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-field">
          <span>{t.settings.hoursTo}</span>
          <select className="crm-input" name="work_end_hour" value={end} onChange={(e) => setEnd(Number(e.target.value))}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourSlot(h)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="wh-days">
        <legend>{t.settings.hoursDays}</legend>
        {names.map((label, d) => (
          <label key={d} className={`wh-day${days.includes(d) ? " wh-day-on" : ""}`}>
            <input
              type="checkbox"
              name="work_days"
              value={d}
              checked={days.includes(d)}
              onChange={() => toggleDay(d)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {preview.length > 0 && (
        <p className="crm-muted crm-sm wh-preview">
          {t.settings.hoursPreview} <strong>{preview.join(" · ")}</strong>
        </p>
      )}

      <p className="crm-muted crm-sm">{t.settings.hoursNote}</p>

      {/* Warned before submit too: these mistakes leave someone unbookable. */}
      {backwards && <p className="crm-auth-error">{t.settings.hoursBackwards}</p>}
      {noDays && !backwards && <p className="crm-auth-error">{t.settings.hoursNoDays}</p>}
      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.saved && !state.error && <p className="crm-saved">{t.settings.saved}</p>}

      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending || backwards || noDays}>
        {pending ? t.settings.saving : t.settings.save}
      </button>
    </form>
  );
}
