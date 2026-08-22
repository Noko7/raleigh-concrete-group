"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";

// Scheduling from the crew's own job page. Same server action the CRM uses, so
// the RLS scoping and the customer text are identical - this is only a different
// surface, built for a phone on a job site: full-width targets, dates spelled
// out, and the confirm buttons above the fold rather than in a dropdown.
function pretty(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JobSchedule({
  id,
  scheduledDate,
  scheduledTime,
  preferredDates,
  minDate,
  locale,
}: {
  id: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  preferredDates: string[];
  minDate: string;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const t = dict(locale);
  const booked = Boolean(scheduledDate);
  // The start time rides along with whichever day gets tapped.
  const [time, setTime] = useState(scheduledTime ?? "9:00 AM");

  // Days still worth offering as a one-tap choice: the customer's picks, minus
  // whichever one is already booked.
  const choices = preferredDates.filter((d) => d !== scheduledDate);

  return (
    <section className="js-card">
      <h2 className="js-title">{booked ? t.contractorJob.schedBookedTitle : t.contractorJob.schedTitle}</h2>

      {booked ? (
        <p className="js-lead">
          {t.contractorJob.schedBookedFor}{" "}
          <strong className="js-booked">
            {pretty(scheduledDate as string, locale)}
            {scheduledTime ? ` · ${scheduledTime}` : ""}
          </strong>
          <br />
          <span className="js-hint">{t.contractorJob.schedChangeHint}</span>
        </p>
      ) : (
        <p className="js-lead">
          {t.contractorJob.schedWaiting}
          <br />
          <span className="js-hint">{t.contractorJob.schedPickHint}</span>
        </p>
      )}

      <label className="js-time">
        <span>{t.contractorJob.schedStartTime}</span>
        <input
          type="time"
          value={to24Hour(time)}
          onChange={(e) => e.target.value && setTime(to12Hour(e.target.value))}
        />
      </label>

      {choices.length > 0 && (
        <div className="js-choices">
          {choices.map((d) => (
            <form action={formAction} key={d}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="date" value={d} />
              <input type="hidden" name="time" value={time} />
              <button type="submit" className="js-choice" disabled={pending}>
                <span className="js-choice-date">{pretty(d, locale)}</span>
                <span className="js-choice-cta">
                  {booked ? t.contractorJob.schedChange : t.contractorJob.schedConfirm}
                </span>
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
          <input
            type="date"
            name="date"
            className="js-date"
            min={minDate}
            defaultValue={scheduledDate ?? ""}
            required
          />
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
