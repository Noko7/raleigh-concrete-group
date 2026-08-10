"use client";

import { useActionState, useState } from "react";

import { VISIT_TIME_SLOTS } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";

// An online request came in with a slot the customer offered in case the job
// turns out to be too big to price from photos. This card is where the crew
// decides. Most of the time they price it from the photos and never touch it;
// when they can't, one tap turns the customer's own suggestion into a real
// appointment and texts both sides.
//
// The requested slot is a button rather than a pre-filled form because the
// customer already picked a workable time. Making the crew re-enter it would
// be asking them to retype the answer that's sitting in front of them.
function pretty(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JobVisit({
  id,
  requestedDate,
  requestedTime,
  minDate,
  locale,
}: {
  id: string;
  requestedDate: string | null;
  requestedTime: string | null;
  minDate: string;
  locale: Locale;
}) {
  const t = dict(locale);
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(confirmVisit, { ok: false });

  // The customer's own time if it's still one we offer, otherwise the first
  // slot - a time slot that no longer exists would be rejected on submit.
  const fallbackTime = requestedTime && VISIT_TIME_SLOTS.includes(requestedTime) ? requestedTime : VISIT_TIME_SLOTS[0];
  const [time, setTime] = useState(fallbackTime);

  return (
    <section className="js-card jv-card">
      <h2 className="js-title">{t.contractorJob.visitTitle}</h2>
      <p className="js-lead">{t.contractorJob.visitLead}</p>

      {requestedDate && (
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="date" value={requestedDate} />
          <input type="hidden" name="time" value={fallbackTime} />
          <div className="jv-asked">
            <span className="jv-asked-label">{t.contractorJob.visitAsked}</span>
            <strong className="jv-asked-day">{pretty(requestedDate, locale)}</strong>
            <strong className="jv-asked-time">{fallbackTime}</strong>
          </div>
          <button type="submit" className="js-confirm" disabled={pending}>
            {pending ? t.contractorJob.visitConfirming : t.contractorJob.visitConfirm}
          </button>
        </form>
      )}

      <details className="js-other" open={!requestedDate}>
        <summary>{t.contractorJob.visitOther}</summary>
        <form action={formAction} className="js-other-form">
          <input type="hidden" name="id" value={id} />
          <label className="js-time">
            <span>{t.contractorJob.visitTime}</span>
            <select value={time} onChange={(e) => setTime(e.target.value)} name="time">
              {VISIT_TIME_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <input
            type="date"
            name="date"
            className="js-date"
            min={minDate}
            defaultValue={requestedDate ?? ""}
            required
          />
          <button type="submit" className="js-confirm" disabled={pending}>
            {pending ? t.contractorJob.visitConfirming : t.contractorJob.visitConfirm}
          </button>
        </form>
      </details>

      <p className="js-hint">{t.contractorJob.visitNote}</p>

      {state.error && <p className="js-err">{state.error}</p>}
      {state.ok && state.message && <p className="js-ok">{state.message}</p>}
    </section>
  );
}
