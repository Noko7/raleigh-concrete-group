"use client";

import { useActionState, useState } from "react";

import { DEFAULT_VISIT_SLOTS, TIME_RE, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";
import { DateField } from "./date-field";

// Booking an on-site visit. Two ways in:
//   online    a photo quote whose customer offered a fallback slot: one-tap accept
//   schedule  an in-person request with no date (cancelled, or predates the field): picker only
// Both end in confirmVisit, which texts the customer.
function pretty(s: string, locale: Locale): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
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

  // The customer's offered time if valid, else the first public slot as a starting point.
  const fallbackTime = requestedTime && TIME_RE.test(requestedTime) ? requestedTime : DEFAULT_VISIT_SLOTS[0];
  const [time, setTime] = useState(fallbackTime);

  // Only an online request arrives with something to accept.
  const offered = mode === "online" ? requestedDate : null;

  const picker = (
    <form action={formAction} className="jv-form">
      <input type="hidden" name="id" value={id} />
      <label className="js-time">
        <span>{t.contractorJob.visitTime}</span>
        <input
          type="time"
          value={to24Hour(time, "08:00")}
          onChange={(e) => e.target.value && setTime(to12Hour(e.target.value))}
        />
        {/* confirmVisit reads FormData, so the time needs a hidden field. */}
        <input type="hidden" name="time" value={time} />
      </label>
      <DateField
        name="date"
        minDate={minDate}
        defaultValue={requestedDate ?? ""}
        locale={locale}
        className="js-date"
      />
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

          {/* Only folded when there's a suggestion; otherwise the picker is the whole card. */}
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
