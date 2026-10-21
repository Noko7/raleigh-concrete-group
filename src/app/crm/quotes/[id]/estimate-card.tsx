"use client";

import { useActionState, useEffect, useState } from "react";

import { DEFAULT_VISIT_SLOTS, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit } from "./schedule-actions";
import type { ScheduleState } from "./types";

function pretty(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// The estimate visit: one button to book it, the same button to move it. confirmVisit texts the customer
// and crew, and turns an online request in-person.
export function EstimateCard({
  id,
  date,
  time,
  booked,
  minDate,
  locale,
}: {
  id: string;
  // The booked visit, or the slot an online customer suggested.
  date: string | null;
  time: string | null;
  booked: boolean;
  minDate: string;
  locale: Locale;
}) {
  const t = dict(locale);
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(confirmVisit, { ok: false });
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(time ?? DEFAULT_VISIT_SLOTS[0]);
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">{t.estimate.title}</h2>

      {date ? (
        <p className="crm-sm">
          {booked ? t.estimate.bookedFor : t.estimate.suggested}{" "}
          <strong className="crm-link-strong">
            {pretty(date)}
            {time ? ` at ${time}` : ""}
          </strong>
          {!booked && <span className="crm-muted"> ({t.estimate.notBooked})</span>}
        </p>
      ) : (
        <p className="crm-muted crm-sm">{t.estimate.none}</p>
      )}

      {!open ? (
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          onClick={() => {
            setStart(time ?? DEFAULT_VISIT_SLOTS[0]);
            setNotify(true);
            setOpen(true);
          }}
        >
          {booked ? t.estimate.move : t.estimate.schedule}
        </button>
      ) : (
        <form action={formAction} className="crm-editor">
          <input type="hidden" name="id" value={id} />
          <label className="crm-field">
            <span>{t.calendar.date}</span>
            <input type="date" name="date" className="crm-input" min={minDate} defaultValue={date ?? ""} required />
          </label>
          <label className="crm-field">
            <span>{t.calendar.time}</span>
            <input
              type="time"
              className="crm-input"
              value={to24Hour(start, "08:00")}
              onChange={(e) => e.target.value && setStart(to12Hour(e.target.value))}
            />
            <input type="hidden" name="time" value={start} />
          </label>
          {/* A first booking always texts: that's how the customer finds out. */}
          {booked ? (
            <label className="cal-panel-check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>
                {t.schedule.notifyMoved}
                <em>{t.schedule.notifyMovedHint}</em>
              </span>
            </label>
          ) : (
            <p className="crm-muted crm-sm">{t.estimate.texts}</p>
          )}
          <input type="hidden" name="notify" value={notify ? "yes" : "no"} />
          <div className="crm-editor-foot">
            <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
              {pending ? t.calendar.saving : t.estimate.save}
            </button>
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.ok && state.message && <p className="crm-muted crm-sm">{state.message}</p>}
    </div>
  );
}
