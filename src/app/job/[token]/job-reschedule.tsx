"use client";

import { useActionState, useEffect, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit, setJobDate } from "@/app/crm/quotes/[id]/schedule-actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";
import { DateField } from "./date-field";

// Directly under the date it changes, collapsed to a button until needed. Not the calendar's overlay panel:
// on a phone it would hide the date being reconsidered.
// Same server actions as the CRM, so texts, log and Google sync are identical.
export function JobReschedule({
  id,
  kind,
  date,
  time,
  minDate,
  locale,
}: {
  id: string;
  kind: "job" | "visit";
  date: string;
  time: string | null;
  minDate: string;
  locale: Locale;
}) {
  const t = dict(locale);
  const isJob = kind === "job";

  // Work days and visits use different columns and texts. `kind` is fixed for the page, so both hooks run.
  const jobMove = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const visitMove = useActionState<ScheduleState, FormData>(confirmVisit, { ok: false });
  const [state, formAction, pending] = isJob ? jobMove : visitMove;

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(time ?? (isJob ? "9:00 AM" : "8:00 AM"));
  const [notify, setNotify] = useState(true);

  // Reopen from the appointment as it stands now. The date field reseeds on remount but the start time lives
  // here, so reset it by hand (remounting would drop the "customer texted" line).
  function reopen() {
    setStart(time ?? (isJob ? "9:00 AM" : "8:00 AM"));
    // Back on every time: an untick is about one move.
    setNotify(true);
    setOpen(true);
  }

  // Saved: fold back (the new date is already shown above). Failures keep the input.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <div className="jr">
        <button type="button" className="jr-open" onClick={reopen}>
          {t.contractorJob.reschedule}
        </button>
        {state.ok && state.message && <p className="js-ok jr-msg">{state.message}</p>}
      </div>
    );
  }

  return (
    <div className="jr">
      <form action={formAction} className="jr-form">
        <input type="hidden" name="id" value={id} />
        <div className="jr-fields">
          <label className="jr-field">
            <span>{t.contractorJob.reschedNewDay}</span>
            <DateField name="date" minDate={minDate} defaultValue={date} locale={locale} />
          </label>
          <label className="jr-field">
            <span>{isJob ? t.contractorJob.schedStartTime : t.contractorJob.visitTime}</span>
            <input
              type="time"
              value={to24Hour(start, isJob ? "09:00" : "08:00")}
              onChange={(e) => e.target.value && setStart(to12Hour(e.target.value))}
            />
            {/* Both actions read FormData and want "H:MM AM/PM", not the picker's 24h value. */}
            <input type="hidden" name="time" value={start} />
          </label>
        </div>

        {/* Before the button: this goes to a customer's phone. */}
        <p className="jr-note">{isJob ? t.contractorJob.reschedNoteJob : t.contractorJob.reschedNoteVisit}</p>
        <label className="jr-check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            {t.schedule.notifyMoved}
            <em>{t.schedule.notifyMovedHint}</em>
          </span>
        </label>
        <input type="hidden" name="notify" value={notify ? "yes" : "no"} />

        <div className="jr-acts">
          <button type="submit" className="js-confirm jr-save" disabled={pending}>
            {pending ? t.contractorJob.schedSaving : t.contractorJob.reschedSave}
          </button>
          <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending}>
            {t.common.cancel}
          </button>
        </div>
      </form>

      {state.error && <p className="js-err jr-msg">{state.error}</p>}
    </div>
  );
}
