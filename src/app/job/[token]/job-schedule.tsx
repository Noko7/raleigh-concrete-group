"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";

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
  preferredDates,
  minDate,
  locale,
}: {
  id: string;
  preferredDates: string[];
  minDate: string;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const t = dict(locale);
  // The start time rides along with whichever day gets tapped.
  const [time, setTime] = useState("9:00 AM");

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
          onChange={(e) => e.target.value && setTime(to12Hour(e.target.value))}
        />
      </label>

      {preferredDates.length > 0 && (
        <div className="js-choices">
          {preferredDates.map((d) => (
            <form action={formAction} key={d}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="date" value={d} />
              <input type="hidden" name="time" value={time} />
              <button type="submit" className="js-choice" disabled={pending}>
                <span className="js-choice-date">{pretty(d, locale)}</span>
                <span className="js-choice-cta">{t.contractorJob.schedConfirm}</span>
              </button>
            </form>
          ))}
        </div>
      )}

      <details className="js-other">
        <summary>{t.contractorJob.schedOther}</summary>
        <form action={formAction} className="js-other-form">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="time" value={time} />
          <input type="date" name="date" className="js-date" min={minDate} required />
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
