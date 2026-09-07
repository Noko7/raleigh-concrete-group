"use client";

import { useActionState, useState } from "react";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dollars } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import type { QuoteSend } from "@/lib/crm/events";
import { retractQuote } from "./actions";
import type { ScheduleState } from "./types";

// Every price this customer has been given, newest first.
//
// The job row only ever holds the current quote, so "we've sent them three
// versions and the second one is the number they're arguing about" was a thing
// you could only reconstruct by reading the activity log line by line. This is
// that reconstruction, done once, sitting above the logs on both job pages.
//
// Newest first because the top row is the live one: it is what the customer is
// holding right now, and the older rows are only ever context for it.

// Raleigh time, like every other stamp the crew and the office read together.
function stamp(iso: string, locale: Locale) {
  return new Date(iso).toLocaleString(locale === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TZ,
  });
}

export function QuoteSends({
  quoteId,
  customerName,
  sends,
  canRetract,
  locale,
  // The two job pages are different colours: the office's is dark, the crew's
  // is a white card. One component, one modifier, rather than two lists that
  // drift apart the first time somebody adds a column to one of them.
  tone = "dark",
}: {
  quoteId: string;
  customerName: string;
  sends: QuoteSend[];
  canRetract: boolean;
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<ScheduleState, FormData>(retractQuote, { ok: false });

  const newest = sends.length - 1;

  return (
    <section className={`qs${tone === "light" ? " qs-light" : ""}`}>
      <h2 className="qs-title">{t.quoteLog.title}</h2>

      {sends.length === 0 ? (
        <p className="qs-none">{t.quoteLog.none}</p>
      ) : (
        <>
          <p className="qs-count">
            {sends.length === 1 ? t.quoteLog.one : fill(t.quoteLog.many, { n: sends.length })}
          </p>

          <ol className="qs-list">
            {sends
              .map((s, i) => ({ ...s, n: i + 1, live: i === newest }))
              .reverse()
              .map((s) => (
                <li key={s.id} className={s.live ? "qs-row qs-row-live" : "qs-row"}>
                  <span className="qs-n">#{s.n}</span>
                  <span className={`qs-amount${s.amount == null ? "" : " qs-has-amount"}`}>
                    {dollars(s.amount) ?? t.quoteLog.noPrice}
                  </span>
                  <span className="qs-when">{stamp(s.at, locale)}</span>
                  <span className="qs-tags">
                    {s.live && <em className="qs-tag qs-tag-live">{t.quoteLog.current}</em>}
                    {s.corrected ? (
                      <em className="qs-tag">{t.quoteLog.corrected}</em>
                    ) : (
                      s.n === 1 && <em className="qs-tag">{t.quoteLog.first}</em>
                    )}
                  </span>
                </li>
              ))}
          </ol>
        </>
      )}

      {/* Owner only, and never on a job with nothing sent. Two steps rather
          than one, because the whole point of the button is that somebody has
          already made one mistake on this job today. */}
      {canRetract && sends.length > 0 && (
        <div className="qs-retract">
          {state.error && <p className="qs-err">{state.error}</p>}
          {state.ok && state.message && <p className="qs-ok">{state.message}</p>}

          {!confirming ? (
            <button type="button" className="qs-retract-open" onClick={() => setConfirming(true)}>
              {t.quoteLog.retract}
            </button>
          ) : (
            <form
              action={(fd) => {
                fd.set("id", quoteId);
                setConfirming(false);
                action(fd);
              }}
            >
              <p className="qs-warn">{fill(t.quoteLog.retractWarn, { name: customerName })}</p>
              <div className="qs-retract-acts">
                <button type="submit" className="crm-btn qs-btn-danger" disabled={pending}>
                  {pending ? t.quoteLog.retracting : t.quoteLog.retractGo}
                </button>
                <button
                  type="button"
                  className="crm-btn crm-btn-ghost"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  {t.quoteLog.retractKeep}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
