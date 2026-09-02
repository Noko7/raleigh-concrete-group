"use client";

import { useActionState, useState } from "react";

import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { cancelAppointment } from "./actions";
import type { ScheduleState } from "./types";

// Calling off an appointment, from wherever you are when the customer asks.
//
// Until now this only existed in the calendar's slide-in panel, which is the
// office moving other people's appointments around a month grid. But the call
// comes in while somebody is looking at the job - the crew on their own page,
// the office on the quote - and "open the calendar, find the right day, find
// the right chip" is a long way round to press one button.
//
// Two steps on purpose. This texts a customer and puts a day back on the
// market, so it is not something to do with one stray tap on a phone in a
// truck. Collapsed it is a quiet link, not a red button competing with
// Reschedule next to it: cancelling is the rarer answer.
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
  // On by default: the usual cancellation is us calling it off on somebody who
  // is expecting us. Turned off when they are the one who asked and you are
  // still on the phone to them.
  const [notify, setNotify] = useState(true);
  // Who called it off. Off by default because the older reason for cancelling
  // is that we can't make it; ticking it swaps the customer's text from an
  // apology to a receipt, and tells the crew who to ask about it.
  const [asked, setAsked] = useState(false);

  const isJob = kind === "job";
  // The first name is enough in a warning that already names the appointment,
  // and it is what the rest of the CRM uses when it addresses a customer.
  const firstName = customerName.trim().split(/\s+/)[0] || customerName;

  // Done: fold away. The date it was about has gone from the page above, so a
  // form still sitting open would be asking about something that isn't there.
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
