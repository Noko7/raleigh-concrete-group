"use client";

import { useActionState, useState } from "react";

import { VISIT_TIME_SLOTS } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";

// Putting a real on-site appointment on the calendar. Two ways in:
//
//   online    the request came in as a photo quote and the customer offered a
//             slot in case the job turned out to be too big to price remotely.
//             Their suggestion is a one-tap button, because they already picked
//             a time that works and retyping it is asking for the answer twice.
//
//   schedule  an in-person request with no date - the visit was cancelled off
//             the calendar, or the row predates the form asking for one. There
//             is nothing to accept, so the picker is the card.
//
// Either way it ends in confirmVisit, which is what texts the customer.
function pretty(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JobVisit({
  id,
  mode,
  requestedDate,
  requestedTime,
  minDate,
  locale,
}: {
  id: string;
  mode: "online" | "schedule";
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

  // Only an online request arrives with something to accept.
  const offered = mode === "online" ? requestedDate : null;

  const picker = (
    <form action={formAction} className="jv-form">
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
      <input type="date" name="date" className="js-date" min={minDate} defaultValue={requestedDate ?? ""} required />
      <button type="submit" className="js-confirm" disabled={pending}>
        {pending ? t.contractorJob.visitConfirming : t.contractorJob.visitConfirm}
      </button>
    </form>
  );

  return (
    <section className="js-card jv-card">
      <h2 className="js-title">{mode === "schedule" ? t.contractorJob.visitScheduleTitle : t.contractorJob.visitTitle}</h2>
      <p className="js-lead">{mode === "schedule" ? t.contractorJob.visitScheduleLead : t.contractorJob.visitLead}</p>

      {offered ? (
        <>
          <form action={formAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="date" value={offered} />
            <input type="hidden" name="time" value={fallbackTime} />
            <div className="jv-asked">
              <span className="jv-asked-label">{t.contractorJob.visitAsked}</span>
              <strong className="jv-asked-day">{pretty(offered, locale)}</strong>
              <strong className="jv-asked-time">{fallbackTime}</strong>
            </div>
            <button type="submit" className="js-confirm" disabled={pending}>
              {pending ? t.contractorJob.visitConfirming : t.contractorJob.visitConfirm}
            </button>
          </form>

          {/* Tucked away only when there's a suggestion to accept. With nothing
              offered, hiding the picker behind a toggle would hide the card's
              entire reason for existing. */}
          <details className="js-other">
            <summary>{t.contractorJob.visitOther}</summary>
            {picker}
          </details>
        </>
      ) : (
        picker
      )}

      <p className="js-hint">{t.contractorJob.visitNote}</p>

      {state.error && <p className="js-err">{state.error}</p>}
      {state.ok && state.message && <p className="js-ok">{state.message}</p>}
    </section>
  );
}
