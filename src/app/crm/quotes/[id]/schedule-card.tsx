"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "./schedule-actions";
import type { PreferredSlot, ScheduleState } from "./types";

function pretty(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Confirming a date books the job and texts the customer, so it's a separate card: saving notes must never
// move a customer's date.
export function ScheduleCard({
  id,
  scheduledDate,
  scheduledTime,
  preferred,
  minDate,
  locale,
}: {
  id: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  preferred: PreferredSlot[];
  minDate: string;
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const t = dict(locale);
  const booked = Boolean(scheduledDate);
  // Seeded from what the customer asked for: 9:00 AM would be a different appointment than their 7:00 AM.
  const [time, setTime] = useState(scheduledTime ?? preferred.find((p) => p.time)?.time ?? "9:00 AM");
  // Until the box is touched, each day books at the time asked for on THAT day; once set, it wins everywhere.
  const [overridden, setOverridden] = useState(false);
  // Moving a booked day texts the customer unless unticked. Hidden field in every form on the card.
  const [notify, setNotify] = useState(true);
  const notifyField = booked ? <input type="hidden" name="notify" value={notify ? "yes" : "no"} /> : null;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">{booked ? t.schedule.bookedTitle : t.schedule.confirmTitle}</h2>

      {booked ? (
        <p className="crm-muted crm-sm">
          {t.schedule.bookedFor}{" "}
          <strong className="crm-link-strong">
            {pretty(scheduledDate as string)}
            {scheduledTime ? ` at ${scheduledTime}` : ""}
          </strong>
          . {t.schedule.changeHint}
        </p>
      ) : (
        <p className="crm-muted crm-sm">{t.schedule.waiting}</p>
      )}

      {/* Any start time (a 6:45 pour shouldn't read 7:00). Carried in the hidden fields below. */}
      <label className="crm-field sched-time">
        <span>{t.schedule.startTime}</span>
        <input
          type="time"
          className="crm-input"
          value={to24Hour(time, "09:00")}
          onChange={(e) => {
            if (!e.target.value) return;
            setTime(to12Hour(e.target.value));
            setOverridden(true);
          }}
        />
      </label>

      {preferred.length > 0 && (
        <div className="sched-picks">
          <p className="crm-sm sched-picks-label">{t.schedule.customerPrefers}</p>
          <div className="sched-pick-row">
            {/* Each button carries that day's requested time; see `overridden` for when the box wins. */}
            {preferred.map((p) => {
              return (
                <form action={formAction} key={p.date}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="date" value={p.date} />
                  <input type="hidden" name="time" value={overridden ? time : (p.time ?? time)} />
                  {notifyField}
                  <button
                    type="submit"
                    className={`crm-btn ${p.date === scheduledDate ? "crm-btn-ghost" : "crm-btn-primary"}`}
                    disabled={pending}
                  >
                    {p.date === scheduledDate
                      ? `${pretty(p.date)} (${t.schedule.booked})`
                      : `${pretty(p.date)}${p.time ? ` · ${p.time}` : ""}`}
                  </button>
                </form>
              );
            })}
          </div>
        </div>
      )}

      <form action={formAction} className="crm-editor sched-custom">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="time" value={time} />
        {notifyField}
        <label className="crm-field">
          <span>{preferred.length > 0 ? t.schedule.orPickAnother : t.schedule.workDay}</span>
          <input type="date" name="date" className="crm-input" min={minDate} defaultValue={scheduledDate ?? ""} required />
        </label>
        {booked && (
          <label className="cal-panel-check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              {t.schedule.notifyMoved}
              <em>{t.schedule.notifyMovedHint}</em>
            </span>
          </label>
        )}
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
