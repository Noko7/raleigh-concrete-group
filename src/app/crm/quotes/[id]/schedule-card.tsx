"use client";

import { useActionState, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { setJobDate } from "./actions";
import type { PreferredSlot, ScheduleState } from "./types";

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
  // Seeded from what the customer asked for, not from a house default. On a
  // quote where they said "Tuesday at 7:00 AM", 9:00 AM in this box is a
  // different appointment than the one they agreed to.
  const [time, setTime] = useState(scheduledTime ?? preferred.find((p) => p.time)?.time ?? "9:00 AM");
  // Whether the box above has been touched. Until it is, each of the customer's
  // days is confirmed at the time they asked for on THAT day - three days can
  // carry three different times. Once the crew sets one deliberately, it wins
  // on every day, because that is what they just said they can do.
  const [overridden, setOverridden] = useState(false);

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

      {/* Any start time, not a list of round hours. A crew that has to be on
          site at 6:45 for a pour shouldn't have to round it to 7:00 in the
          text the customer gets. The value rides along in the hidden fields
          below, so every way of booking a day carries the same time. */}
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
            {/* Each button carries the time the customer asked for on THAT day
                rather than one shared value, so tapping their Tuesday books
                their Tuesday. See `overridden` above for when the box wins. */}
            {preferred.map((p) => {
              return (
                <form action={formAction} key={p.date}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="date" value={p.date} />
                  <input type="hidden" name="time" value={overridden ? time : (p.time ?? time)} />
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
        <label className="crm-field">
          <span>{preferred.length > 0 ? t.schedule.orPickAnother : t.schedule.workDay}</span>
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
