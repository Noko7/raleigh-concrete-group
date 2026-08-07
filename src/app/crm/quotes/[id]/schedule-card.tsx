"use client";

import { useActionState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "./actions";
import type { ScheduleState } from "./types";

function pretty(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Confirming a date is what actually books the job and texts the customer, so
// this is deliberately a separate card rather than another field in the editor -
// it shouldn't be possible to move a customer's date as a side effect of saving
// unrelated notes.
export function ScheduleCard({
  id,
  scheduledDate,
  preferredDates,
  minDate,
  locale,
}: {
  id: string;
  scheduledDate: string | null;
  preferredDates: string[];
  minDate: string;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const t = dict(locale);
  const booked = Boolean(scheduledDate);

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">{booked ? t.schedule.bookedTitle : t.schedule.confirmTitle}</h2>

      {booked ? (
        <p className="crm-muted crm-sm">
          {t.schedule.bookedFor} <strong className="crm-link-strong">{pretty(scheduledDate as string)}</strong>.{" "}
          {t.schedule.changeHint}
        </p>
      ) : (
        <p className="crm-muted crm-sm">
          {t.schedule.waiting}
        </p>
      )}

      {preferredDates.length > 0 && (
        <div className="sched-picks">
          <p className="crm-sm sched-picks-label">{t.schedule.customerPrefers}</p>
          <div className="sched-pick-row">
            {preferredDates.map((d) => (
              <form action={formAction} key={d}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="date" value={d} />
                <button
                  type="submit"
                  className={`crm-btn ${d === scheduledDate ? "crm-btn-ghost" : "crm-btn-primary"}`}
                  disabled={pending || d === scheduledDate}
                >
                  {d === scheduledDate ? `${pretty(d)} (${t.schedule.booked})` : pretty(d)}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}

      <form action={formAction} className="crm-editor sched-custom">
        <input type="hidden" name="id" value={id} />
        <label className="crm-field">
          <span>{preferredDates.length > 0 ? t.schedule.orPickAnother : t.schedule.workDay}</span>
          <input type="date" name="date" className="crm-input" min={minDate} defaultValue={scheduledDate ?? ""} required />
        </label>
        <div className="crm-editor-foot">
          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? t.schedule.saving : booked ? t.schedule.change : t.schedule.confirm}
          </button>
          {state.error && <span className="crm-auth-error">{state.error}</span>}
          {state.ok && state.message && <span className="crm-sm sched-ok">{state.message}</span>}
        </div>
      </form>
    </div>
  );
}
