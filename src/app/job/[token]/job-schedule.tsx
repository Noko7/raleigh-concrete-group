"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "@/app/crm/quotes/[id]/schedule-actions";
import type { PreferredSlot, ScheduleState } from "@/app/crm/quotes/[id]/types";
import { DateField } from "./date-field";

// Same server action as the CRM (same RLS and customer text), laid out for a phone. Only for jobs with no
// date; moving an existing date is JobReschedule.
function pretty(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
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
  // Seeded from the customer's requested time; touching the box overrides it for every day (see `overridden`).
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
                <span className="js-choice-date">{pretty(p.date)}</span>
                {/* A day alone reads as "any time", which is how a crew turns up at 9 for a 7 o'clock pour. */}
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
