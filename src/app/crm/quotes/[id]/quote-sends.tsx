"use client";

import { useActionState, useState } from "react";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { dollars } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import type { QuoteSend } from "@/lib/crm/events";
import { AddOption, type SentOption } from "./add-option";
import { retractQuote } from "./actions";
import type { ScheduleState } from "./types";

// Every price this customer has been given, newest first (the top row is what they hold now). The job row
// only stores the current quote.

// Raleigh time.
function stamp(iso: string, locale: Locale) {
  return new Date(iso).toLocaleString("en-US", {
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
  // The quote is out and unanswered. Otherwise the button isn't shown, rather than failing when pressed.
  canAddOption,
  currentAmount,
  service,
  options,
  locale,
  // Office page is dark, crew page is a white card: one component with a modifier so they don't drift.
  tone = "dark",
}: {
  quoteId: string;
  customerName: string;
  sends: QuoteSend[];
  canRetract: boolean;
  canAddOption?: boolean;
  currentAmount?: number | null;
  service?: string | null;
  options?: SentOption[];
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
                  {/* Two columns so every tag aligns regardless of how many a row has. */}
                  <span className="qs-flag">
                    {s.live && <em className="qs-tag qs-tag-live">{t.quoteLog.current}</em>}
                  </span>
                  <span className="qs-kind">
                    {/* An added option is not a correction: the earlier price wasn't wrong. */}
                    {s.added ? (
                      <em className="qs-tag qs-tag-added" title={s.added}>
                        {fill(t.quoteLog.optionAdded, { title: s.added })}
                      </em>
                    ) : s.corrected ? (
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

      {/* Here rather than in the quote form: the crew reach for it while reading back what was sent. */}
      {canAddOption && sends.length > 0 && (
        <AddOption
          quoteId={quoteId}
          customerName={customerName}
          currentAmount={currentAmount ?? null}
          service={service ?? null}
          options={options ?? []}
          locale={locale}
          tone={tone}
        />
      )}

      {/* Owner only, two steps: someone has already made one mistake on this job. */}
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
