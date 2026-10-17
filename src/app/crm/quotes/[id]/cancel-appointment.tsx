"use client";

import { useActionState, useState } from "react";

import { firstNameOf } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { cancelAppointment } from "./schedule-actions";
import type { ScheduleState } from "./types";

// Cancel an appointment from the job itself (crew page or quote page), where the
// call usually comes in, not only from the calendar panel.
//
// Two steps on purpose: it texts a customer and frees the day, so not a stray
// tap. Collapsed it's a quiet link, since cancelling is rarer than Reschedule.
export function CancelAppointment({
  id,
  kind,
  customerName,
  locale,
}: {
  id: string;
  kind: "job" | "visit";
  customerName: string;
  locale: Locale;
}) {
  const t = dict(locale);
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(cancelAppointment, { ok: false });
  const [open, setOpen] = useState(false);
  // On by default: usually we're calling it off on someone expecting us. Off
  // when they asked and you're still on the phone.
  const [notify, setNotify] = useState(true);
  // Customer asked? Off by default (usually we can't make it). Ticked, their text
  // becomes a receipt instead of an apology and the crew learn who to ask.
  const [asked, setAsked] = useState(false);

  const isJob = kind === "job";
  // First name, as elsewhere in the CRM; the warning already names the appointment.
  const firstName = firstNameOf(customerName, customerName);

  // Done: fold away; the date is gone from the page above.
  if (state.ok) {
    return (
      <div className="ca">
        <p className="ca-msg ca-ok">{state.message}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="ca">
        <button type="button" className="ca-open" onClick={() => setOpen(true)}>
          {t.calendar.cancelAppt}
        </button>
      </div>
    );
  }

  return (
    <div className="ca">
      <form
        className="ca-form"
        action={(fd) => {
          fd.set("id", id);
          fd.set("kind", kind);
          fd.set("notify", notify ? "yes" : "no");
          fd.set("asked", asked ? "yes" : "no");
          formAction(fd);
        }}
      >
        <p className="ca-warn">{fill(isJob ? t.calendar.warnJob : t.calendar.warnVisit, { name: firstName })}</p>

        <label className="ca-check">
          <input type="checkbox" checked={asked} onChange={(e) => setAsked(e.target.checked)} />
          <span>
            {t.calendar.askedLabel}
            <em>{t.calendar.askedHint}</em>
          </span>
        </label>

        <label className="ca-check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            {fill(t.calendar.notifyLabel, { name: firstName })}
            <em>{t.calendar.notifyHint}</em>
          </span>
        </label>

        <div className="ca-acts">
          <button type="submit" className="crm-btn cal-btn-danger" disabled={pending}>
            {pending ? t.calendar.removing : isJob ? t.calendar.releaseDate : t.calendar.removeVisit}
          </button>
          <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending}>
            {t.calendar.keepIt}
          </button>
        </div>
      </form>

      {state.error && <p className="ca-msg ca-err">{state.error}</p>}
    </div>
  );
}
