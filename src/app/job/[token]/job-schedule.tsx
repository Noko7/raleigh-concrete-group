"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "@/app/crm/quotes/[id]/actions";
import type { PreferredSlot, ScheduleState } from "@/app/crm/quotes/[id]/types";
import { DateField } from "./date-field";

// Settling the work day from the crew's own job page. Same server action the CRM
// uses, so the RLS scoping and the customer text are identical - this is only a
// different surface, built for a phone on a job site: full-width targets, dates
// spelled out, and the confirm buttons above the fold rather than in a dropdown.
//
// Only ever shown on a job with no date yet. Moving a date that already exists
// is JobReschedule, under the date itself at the top of the page.
function pretty(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JobSchedule({
  id,
  preferred,
  minDate,
  locale,
}: {
  id: string;
  preferred: PreferredSlot[];
  minDate: string;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const t = dict(locale);
  // Seeded from the time the customer asked for, so the crew standing in the
  // yard confirms the appointment that was actually agreed rather than a house
  // default. Touching the box overrides it for every day - see `overridden`.
  const [time, setTime] = useState(preferred.find((p) => p.time)?.time ?? "9:00 AM");
  const [overridden, setOverridden] = useState(false);

  return (
    <section className="js-card">
      <h2 className="js-title">{t.contractorJob.schedTitle}</h2>

      <p className="js-lead">
        {t.contractorJob.schedWaiting}
        <br />
        <span className="js-hint">{t.contractorJob.schedPickHint}</span>
      </p>

      <label className="js-time">
        <span>{t.contractorJob.schedStartTime}</span>
        <input
          type="time"
          value={to24Hour(time)}
          onChange={(e) => {
            if (!e.target.value) return;
            setTime(to12Hour(e.target.value));
            setOverridden(true);
          }}
        />
      </label>

      {preferred.length > 0 && (
        <div className="js-choices">
          {preferred.map((p) => (
            <form action={formAction} key={p.date}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="date" value={p.date} />
              <input type="hidden" name="time" value={overridden ? time : (p.time ?? time)} />
              <button type="submit" className="js-choice" disabled={pending}>
                <span className="js-choice-date">{pretty(p.date, locale)}</span>
                {/* The hour is on the button because it is half of what they
                    are agreeing to. A day alone reads as "any time that day",
                    which is how a crew turns up at 9 for a 7 o'clock pour. */}
                {p.time && !overridden && <span className="js-choice-time">{p.time}</span>}
                <span className="js-choice-cta">{t.contractorJob.schedConfirm}</span>
              </button>
            </form>
          ))}
        </div>
      )}

      <details className="js-other">
        <summary>{preferred.length > 0 ? t.contractorJob.schedOther : t.schedule.workDay}</summary>
        <form action={formAction} className="js-other-form">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="time" value={time} />
          <DateField name="date" minDate={minDate} locale={locale} className="js-date" />
          <button type="submit" className="js-confirm" disabled={pending}>
            {pending ? t.contractorJob.schedSaving : t.contractorJob.schedConfirm}
          </button>
        </form>
      </details>

      {state.error && <p className="js-err">{state.error}</p>}
      {state.ok && state.message && <p className="js-ok">{state.message}</p>}
    </section>
  );
}
