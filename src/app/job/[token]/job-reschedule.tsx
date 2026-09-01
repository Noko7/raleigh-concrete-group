"use client";

import { useActionState, useEffect, useState } from "react";

import { to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, type Locale } from "@/lib/crm/i18n";
import { confirmVisit, setJobDate } from "@/app/crm/quotes/[id]/actions";
import type { ScheduleState } from "@/app/crm/quotes/[id]/types";
import { DateField } from "./date-field";

// Moving an appointment that already exists, from the crew's own job page.
//
// It sits directly under the date it changes rather than in a card of its own,
// because that date is the thing being questioned: the crew looks at the day at
// the top of the page, realises they can't make it, and the way out is right
// there. Collapsed to a single button until it's needed - a booked job is
// settled, and a date picker sitting open on it reads as unfinished work.
//
// Deliberately not the calendar's slide-in panel. That surface is the office
// moving other people's appointments around a month grid; this is one person
// changing one date they already have on screen, and an overlay on a phone
// hides the very date they're deciding against.
//
// Both kinds go through the same server actions the CRM uses, so the customer
// text, the crew text, the event log and the Google Calendar sync are identical
// no matter which screen the change was made from.
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

  // A work day and a quote visit live in different columns and send different
  // texts, so they have different actions. `kind` is fixed for the life of the
  // page, so both hooks run and one result is used.
  const jobMove = useActionState<ScheduleState, FormData>(setJobDate, { ok: false });
  const visitMove = useActionState<ScheduleState, FormData>(confirmVisit, { ok: false });
  const [state, formAction, pending] = isJob ? jobMove : visitMove;

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(time ?? (isJob ? "9:00 AM" : "8:00 AM"));

  // Opening always starts from the appointment as it stands now, which after a
  // save is the day that was just set rather than the one this component first
  // mounted with. The date field reseeds itself - collapsing unmounts the whole
  // form - but the start time outlives it up here, so it's reset by hand. Not
  // done by remounting this component on the new date, because that would take
  // the "customer texted" line down with it.
  function reopen() {
    setStart(time ?? (isJob ? "9:00 AM" : "8:00 AM"));
    setOpen(true);
  }

  // Saved: fold back to the button. The new day is already the big date above,
  // so leaving the form open would show the same answer twice. A failure keeps
  // it open with what they typed still in it.
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
            {/* Both actions read FormData rather than component state, and both
                want "H:MM AM/PM" rather than the 24h value the picker holds. */}
            <input type="hidden" name="time" value={start} />
          </label>
        </div>

        {/* Said before the button, not after: this change goes to a customer's
            phone, and that's the part worth knowing in advance. */}
        <p className="jr-note">{isJob ? t.contractorJob.reschedNoteJob : t.contractorJob.reschedNoteVisit}</p>

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
