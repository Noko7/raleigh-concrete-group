"use client";

import { useActionState, useMemo, useState } from "react";

import { firstNameOf, dollars, optionAmount, packageLetter, quoteTotal, TIME_RE, to12Hour, to24Hour } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { DateField } from "@/app/job/[token]/date-field";
import { acceptOffline } from "./actions";
import type { ScheduleState } from "./types";

// "They said yes on the phone."
//
// Everything after the quote waits on the customer's own accept. Without this
// the crew resend the quote just to get it pressed, and the customer's picker
// starts a week out, past the day already agreed. This records the approval as
// staff (named, logged, never passed off as the customer's click) and books the
// agreed day in the same submit, from a picker starting today.
//
// One component, two tones (dark office page, white crew card), so one copy of
// a fiddly form.
export function AcceptOffline({
  id,
  customerName,
  amount,
  options,
  packages,
  minDate,
  locale,
  tone = "dark",
}: {
  id: string;
  customerName: string;
  amount: number | null;
  // Each optional line needs an answer before recording, as on the customer
  // page: a blank is not a yes.
  options: { id: string; title: string; description: string | null; amount: number; required: boolean }[];
  // A package must be picked first: "they said yes" doesn't say to what, and
  // the price depends on it.
  packages: { id: string; title: string; amount: number; recommended: boolean }[];
  minDate: string;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(acceptOffline, { ok: false });

  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, "accepted" | "declined">>({});
  // Nothing preselected, as on the customer page: a default is someone's memory of the call.
  const [picked, setPicked] = useState<string | null>(null);
  // On by default: the day is what the crew most need written down while it's fresh.
  const [withDate, setWithDate] = useState(true);
  const [time, setTime] = useState("9:00 AM");
  // On by default: the text is the written record if the day is disputed. Off
  // when the customer asked, or is still on the phone.
  const [notify, setNotify] = useState(true);

  const first = firstNameOf(customerName, customerName);
  const optional = options.filter((o) => !o.required);
  const required = options.filter((o) => o.required);
  const answered = optional.every((o) => choices[o.id]);
  const offersChoice = packages.length > 0;
  const chosen = packages.find((p) => p.id === picked) ?? null;
  // Live total, so the crew can read it back before committing.
  const total = useMemo(
    () => (options.length > 0 || chosen ? quoteTotal(chosen, options, choices) : amount),
    [options, choices, chosen, amount],
  );
  // Only when nothing else carries the job; with a package, no to all add-ons is fine.
  const nothingTaken =
    options.length > 0 &&
    !chosen &&
    required.length === 0 &&
    !optional.some((o) => choices[o.id] === "accepted");
  const ready =
    answered && !nothingTaken && (!offersChoice || Boolean(chosen)) && (!withDate || TIME_RE.test(time));

  // White card on the crew page, dark on the office's; one outer modifier.
  const card = tone === "light" ? "ao ao-light" : "ao";

  // Recorded: fold away. The page re-renders as approved, so a still-open form
  // would offer to approve it again.
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
          fd.set("package", picked ?? "");
          fd.set("notify", notify ? "yes" : "no");
          // A browser-restored stale date would still post, so clear it when off.
          if (!withDate) {
            fd.delete("date");
            fd.set("time", "");
          }
          formAction(fd);
        }}
      >
        {/* Package first: every number on the form depends on it. */}
        {offersChoice && (
          <div className="ao-options ao-picks">
            <p className="ao-label">{t.acceptOffline.whichOption}</p>
            <p className="ao-hint">{t.acceptOffline.whichOptionHint}</p>
            {packages.map((pkg, i) => (
              <button
                key={pkg.id}
                type="button"
                className={picked === pkg.id ? "ao-pick ao-on" : "ao-pick"}
                aria-pressed={picked === pkg.id}
                onClick={() => setPicked(pkg.id)}
              >
                <span className="ao-pick-letter">{packageLetter(i)}</span>
                <span className="ao-opt-title">{pkg.title}</span>
                <span className="ao-opt-amount">{dollars(pkg.amount)}</span>
              </button>
            ))}
          </div>
        )}

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
                  {/* Two buttons, not a checkbox: unticked and "they said no"
                      look identical. */}
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

        {/* With only packages, the total needs its own line so the crew have a
            figure to read back. */}
        {offersChoice && options.length === 0 && (
          <p className="ao-total">
            {t.acceptOffline.agreedTotal} <strong>{dollars(total) ?? "-"}</strong>
          </p>
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
              {/* The action reads FormData, so the time needs a named field. */}
              <input type="hidden" name="time" value={time} />
            </label>
            {/* minDate is today: the lead-time floor is for customers (see acceptOffline). */}
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

        {offersChoice && !chosen && <p className="ao-hint">{t.acceptOffline.pickOption}</p>}
        {!answered && <p className="ao-hint">{t.acceptOffline.answerAll}</p>}
        {nothingTaken && <p className="ao-hint">{t.acceptOffline.tookNothing}</p>}
      </form>

      {state.error && <p className="ao-err">{state.error}</p>}
    </section>
  );
}
