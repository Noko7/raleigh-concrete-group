"use client";

import { useActionState, useMemo, useState } from "react";

import { dollars, optionAmount, selectedTotal, TIME_RE, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { DateField } from "@/app/job/[token]/date-field";
import { acceptOffline } from "./actions";
import type { ScheduleState } from "./types";

// "They said yes on the phone."
//
// Everything past the quote waits on the customer pressing accept on their own
// link: the schedule card, the deposit, the money page, the calendar. When they
// say yes out loud instead - which is most of them - the crew were left sending
// a second quote purely to get the button pressed, and that second quote puts
// the CUSTOMER'S date picker in front of them, which will not offer a day
// sooner than a week out. So a customer who agreed to Thursday gets shown a
// calendar starting the following Tuesday, and whatever comes back is not the
// day anybody agreed to.
//
// This card is the other way in. It records the approval as staff - named,
// logged, and never dressed up as the customer's own click - and takes the day
// they agreed to in the same submit, off a picker that starts today.
//
// Two tones, one component, same reason as QuoteSends: the office's page is
// dark and the crew's is a white card, and two copies of a form this fiddly
// would drift the first time somebody fixed a bug in one of them.
export function AcceptOffline({
  id,
  customerName,
  amount,
  options,
  minDate,
  locale,
  tone = "dark",
}: {
  id: string;
  customerName: string;
  amount: number | null;
  // The line items, if this quote was written as a list. Each optional one
  // needs its own answer before anything is recorded - the same rule the
  // customer's own page runs on, for the same reason: a blank is not a yes.
  options: { id: string; title: string; description: string | null; amount: number; required: boolean }[];
  minDate: string;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(acceptOffline, { ok: false });

  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, "accepted" | "declined">>({});
  // On by default. The whole point of this card is a job agreed on a call, and
  // the day is the half of that conversation the crew most needs written down
  // while they still have it in front of them.
  const [withDate, setWithDate] = useState(true);
  const [time, setTime] = useState("9:00 AM");
  // On by default: a text is the written record of a verbal agreement, which is
  // the thing that protects everybody if the day is later disputed. Turned off
  // when the customer asked not to be texted, or is still on the phone.
  const [notify, setNotify] = useState(true);

  const first = customerName.trim().split(/\s+/)[0] || customerName;
  const optional = options.filter((o) => !o.required);
  const required = options.filter((o) => o.required);
  const answered = optional.every((o) => choices[o.id]);
  // What the job is worth given the answers so far, so the crew can read the
  // number back down the phone before they commit to it.
  const total = useMemo(
    () => (options.length > 0 ? selectedTotal(options, choices) : amount),
    [options, choices, amount],
  );
  const nothingTaken = options.length > 0 && required.length === 0 && !optional.some((o) => choices[o.id] === "accepted");
  const ready = answered && !nothingTaken && (!withDate || TIME_RE.test(time));

  // The crew's page is a white card and the office's is dark. Same markup, one
  // modifier on the outside; every rule inside keys off it.
  const card = tone === "light" ? "ao ao-light" : "ao";

  // Recorded: fold away. The page behind it has re-rendered into an approved
  // job - the schedule card, or the booked date at the top - so a form still
  // sitting open would be offering to approve something already approved.
  if (state.ok) {
    return (
      <section className={card}>
        <p className="ao-ok">{state.message}</p>
      </section>
    );
  }

  if (!open) {
    return (
      <section className={card}>
        <h2 className="ao-title">{t.acceptOffline.title}</h2>
        <p className="ao-lead">{fill(t.acceptOffline.lead, { name: first })}</p>
        <button type="button" className="ao-open" onClick={() => setOpen(true)}>
          {t.acceptOffline.open}
        </button>
      </section>
    );
  }

  return (
    <section className={card}>
      <h2 className="ao-title">{t.acceptOffline.title}</h2>
      <p className="ao-lead">{fill(t.acceptOffline.lead, { name: first })}</p>

      <form
        className="ao-form"
        action={(fd) => {
          fd.set("id", id);
          fd.set("options", JSON.stringify(choices));
          fd.set("notify", notify ? "yes" : "no");
          // The date fields are only in the DOM when the toggle is on, but a
          // stale value from a browser restoring the form would still post, so
          // the off state clears them rather than trusting them to be absent.
          if (!withDate) {
            fd.delete("date");
            fd.set("time", "");
          }
          formAction(fd);
        }}
      >
        {options.length > 0 && (
          <div className="ao-options">
            <p className="ao-label">{t.acceptOffline.whatTheyTook}</p>
            {required.map((o) => (
              <div key={o.id} className="ao-opt ao-opt-req">
                <span className="ao-opt-title">{o.title}</span>
                <span className="ao-opt-amount">{dollars(optionAmount(o))}</span>
                <span className="ao-opt-tag">{t.acceptOffline.included}</span>
              </div>
            ))}
            {optional.map((o) => (
              <div key={o.id} className="ao-opt">
                <span className="ao-opt-title">{o.title}</span>
                <span className="ao-opt-amount">{dollars(optionAmount(o))}</span>
                <span className="ao-opt-pick">
                  {/* Two explicit buttons rather than a checkbox, because an
                      unticked box and "they said no" look identical and only
                      one of them is an answer. */}
                  <button
                    type="button"
                    className={choices[o.id] === "accepted" ? "ao-yes ao-on" : "ao-yes"}
                    onClick={() => setChoices((c) => ({ ...c, [o.id]: "accepted" }))}
                  >
                    {t.acceptOffline.yes}
                  </button>
                  <button
                    type="button"
                    className={choices[o.id] === "declined" ? "ao-no ao-on" : "ao-no"}
                    onClick={() => setChoices((c) => ({ ...c, [o.id]: "declined" }))}
                  >
                    {t.acceptOffline.no}
                  </button>
                </span>
              </div>
            ))}
            <p className="ao-total">
              {t.acceptOffline.agreedTotal} <strong>{dollars(total) ?? "-"}</strong>
            </p>
          </div>
        )}

        <label className="ao-check">
          <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} />
          <span>
            {t.acceptOffline.bookNow}
            <em>{t.acceptOffline.bookNowHint}</em>
          </span>
        </label>

        {withDate && (
          <div className="ao-when">
            <label className="ao-time">
              <span>{t.acceptOffline.startTime}</span>
              <input
                type="time"
                value={to24Hour(time, "09:00")}
                onChange={(e) => e.target.value && setTime(to12Hour(e.target.value))}
              />
              {/* The action reads FormData, not component state, so the picked
                  time needs its own field carrying the display copy. */}
              <input type="hidden" name="time" value={time} />
            </label>
            {/* minDate is today, not a week out. See the comment on the action:
                the floor exists to stop a CUSTOMER committing an unchecked
                crew, and the person filling this in is the crew. */}
            <DateField name="date" minDate={minDate} locale={locale} className="ao-date" />
          </div>
        )}

        <label className="ao-check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            {fill(t.acceptOffline.notifyLabel, { name: first })}
            <em>{withDate ? t.acceptOffline.notifyHintBooked : t.acceptOffline.notifyHint}</em>
          </span>
        </label>

        <p className="ao-warn">{fill(t.acceptOffline.warn, { name: first })}</p>

        <div className="ao-acts">
          <button type="submit" className="ao-go" disabled={pending || !ready}>
            {pending
              ? t.acceptOffline.recording
              : withDate
                ? t.acceptOffline.recordAndBook
                : t.acceptOffline.record}
          </button>
          <button type="button" className="ao-cancel" onClick={() => setOpen(false)} disabled={pending}>
            {t.acceptOffline.cancel}
          </button>
        </div>

        {!answered && <p className="ao-hint">{t.acceptOffline.answerAll}</p>}
        {nothingTaken && <p className="ao-hint">{t.acceptOffline.tookNothing}</p>}
      </form>

      {state.error && <p className="ao-err">{state.error}</p>}
    </section>
  );
}
