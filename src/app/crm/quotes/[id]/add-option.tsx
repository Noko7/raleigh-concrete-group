"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AutoTextarea } from "@/components/auto-textarea";
import { dollars, PACKAGE_TITLE_MAX, packageLetter } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { addQuoteOption } from "./actions";
import type { SaveState } from "./types";

// "They said it's too much. Send them the asphalt price as well."
//
// The whole of this flow already existed, spread across the quote editor: open
// it, find the choice builder, retype the price the customer is holding as
// Option A, add Option B, press Send and hope it goes out as a correction
// rather than bouncing off the duplicate guard. That is four screens of desk
// work, and the conversation that starts it happens on a phone in a driveway
// while the customer is still on the line.
//
// So this is one door onto it, opened from the one card that is already about
// "what have we sent this person": Quotes sent. One modal, two prices, one
// button, and the customer's own link shows both the moment it lands.
//
// Two tones, one component, same as QuoteSends and AcceptOffline: the office's
// page is dark and the crew's is a white card, and two copies of a form this
// fiddly would drift the first time somebody fixed a bug in one of them.

export type SentOption = { id: string; title: string; amount: number; recommended: boolean };

export function AddOption({
  quoteId,
  customerName,
  // The price the customer is currently holding. Becomes Option A's price the
  // first time, pre-filled and editable.
  currentAmount,
  // The job's service, e.g. "Concrete Driveways". The best guess we have at what
  // to call the quote they already have, and only ever a guess - it is shown in
  // an editable box, never written on their behalf.
  service,
  // The options already on this quote. Empty on the ordinary quote, which is the
  // case this flow is really for: one flat price that has to become Option A.
  options,
  locale,
  tone = "dark",
}: {
  quoteId: string;
  customerName: string;
  currentAmount: number | null;
  service: string | null;
  options: SentOption[];
  locale: Locale;
  tone?: "dark" | "light";
}) {
  const t = dict(locale).addOption;
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveState, FormData>(addQuoteOption, { ok: false });

  const [open, setOpen] = useState(false);
  const first = customerName.trim().split(/\s+/)[0] || customerName;
  // Already a choice: they are adding a third, and the ones on the quote are
  // shown as context rather than asked for again.
  const converting = options.length === 0;

  // Title-cased from the service, so "Concrete Driveways" opens as "Concrete
  // driveway" rather than as a database value. Only a starting point.
  const guess = (service ?? "").trim().replace(/s$/i, "");
  const [keepTitle, setKeepTitle] = useState(guess);
  const [keepAmount, setKeepAmount] = useState(currentAmount != null ? String(currentAmount) : "");
  const [keepDesc, setKeepDesc] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDesc, setAddDesc] = useState("");
  // Which one the crew would pick, by index into the list as the customer will
  // see it. -1 is "no recommendation".
  //
  // Seeded from whatever the quote already says rather than from -1. The server
  // rewrites every card's flag from this one number, so defaulting to "none" on
  // a quote that already recommends something would quietly strip that
  // recommendation off the customer's page the moment anybody sent a third
  // option. On the first pass there is nothing to carry and it starts at -1,
  // which is right: pushing one is a decision, not a box to opt out of.
  const [recommend, setRecommend] = useState(() => options.findIndex((o) => o.recommended));

  // Escape, and the page behind it stops scrolling. Same handling as the
  // gallery lightbox, for the same reason: a modal you cannot dismiss with the
  // key everybody reaches for is a modal people close by reloading.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, pending]);

  // Sent: fold the modal away and pull the page fresh, so the new line is in
  // Quotes sent behind it rather than appearing on the next navigation.
  useEffect(() => {
    if (state.ok && state.sent) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  const money = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const keepOk = !converting || (keepTitle.trim() !== "" && money(keepAmount) > 0);
  const ready = keepOk && addTitle.trim() !== "" && money(addAmount) > 0;

  // Exactly what the customer will be looking at, in their order. Built here so
  // the preview cannot drift from what the server is about to save.
  const preview = converting
    ? [
        { title: keepTitle.trim() || t.previewUnnamed, amount: money(keepAmount) },
        { title: addTitle.trim() || t.previewUnnamed, amount: money(addAmount) },
      ]
    : [...options, { title: addTitle.trim() || t.previewUnnamed, amount: money(addAmount) }];

  const box = tone === "light" ? "ao ao-light" : "ao";

  return (
    <>
      <div className="qs-add">
        <button type="button" className="qs-add-open" onClick={() => setOpen(true)}>
          {t.open}
        </button>
        <p className="qs-add-hint">{fill(t.openHint, { name: first })}</p>
        {/* The result lands out here rather than in the modal, because a send
            closes the modal. A held text is its own answer, not a failure. */}
        {state.ok && state.sent && !pending && (
          <p className={state.smsDelivered ? "qs-ok" : state.smsHeldUntil ? "qs-held" : "qs-err"}>
            {state.smsDelivered
              ? fill(t.sentOk, { name: first })
              : state.smsHeldUntil
                ? fill(t.sentHeld, { when: state.smsHeldUntil })
                : t.sentFailed}
          </p>
        )}
      </div>

      {open && (
        <div
          className="qsm"
          role="dialog"
          aria-modal="true"
          aria-label={t.title}
          onClick={() => {
            if (!pending) setOpen(false);
          }}
        >
          {/* Clicks inside the panel must not reach the backdrop above, or
              every tap on a field closes the form. */}
          <div className={`qsm-panel ${box}`} onClick={(e) => e.stopPropagation()}>
            <div className="qsm-head">
              <h2 className="ao-title">{t.title}</h2>
              <button
                type="button"
                className="qsm-x"
                aria-label={t.close}
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                &times;
              </button>
            </div>
            <p className="ao-lead">{fill(converting ? t.leadConvert : t.leadAdd, { name: first })}</p>

            <form
              className="ao-form"
              action={(fd) => {
                fd.set("id", quoteId);
                fd.set("recommend", String(recommend));
                formAction(fd);
              }}
            >
              {/* What they are already holding. Editable on the first pass,
                  because "Concrete Driveways" off the job row is a guess and
                  the customer is about to read it. */}
              {converting ? (
                <fieldset className="qsm-step">
                  <legend>
                    <span className="qsm-letter">{packageLetter(0)}</span>
                    {t.keepLegend}
                  </legend>
                  <p className="ao-hint">{t.keepHint}</p>
                  <div className="qsm-row">
                    <label className="qsm-field qsm-field-wide">
                      <span>{t.name}</span>
                      <input
                        name="keep_title"
                        value={keepTitle}
                        onChange={(e) => setKeepTitle(e.target.value)}
                        maxLength={PACKAGE_TITLE_MAX}
                        placeholder={t.keepNamePlaceholder}
                      />
                    </label>
                    <label className="qsm-field qsm-field-price">
                      <span>{t.price}</span>
                      <input
                        name="keep_amount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={keepAmount}
                        onChange={(e) => setKeepAmount(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="qsm-field">
                    <span>{t.covers}</span>
                    <AutoTextarea
                      name="keep_desc"
                      rows={2}
                      value={keepDesc}
                      onChange={(e) => setKeepDesc(e.target.value)}
                      placeholder={t.coversPlaceholder}
                      maxLength={2000}
                    />
                  </label>
                </fieldset>
              ) : (
                <div className="qsm-have">
                  <p className="ao-label">{t.alreadyOffered}</p>
                  {options.map((o, i) => (
                    <div key={o.id} className="qsm-have-row">
                      <span className="qsm-letter">{packageLetter(i)}</span>
                      <span className="ao-opt-title">{o.title}</span>
                      <span className="ao-opt-amount">{dollars(o.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <fieldset className="qsm-step qsm-step-new">
                <legend>
                  <span className="qsm-letter">{packageLetter(converting ? 1 : options.length)}</span>
                  {t.addLegend}
                </legend>
                <p className="ao-hint">{t.addHint}</p>
                <div className="qsm-row">
                  <label className="qsm-field qsm-field-wide">
                    <span>{t.name}</span>
                    <input
                      name="add_title"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      maxLength={PACKAGE_TITLE_MAX}
                      placeholder={t.addNamePlaceholder}
                      autoFocus
                    />
                  </label>
                  <label className="qsm-field qsm-field-price">
                    <span>{t.price}</span>
                    <input
                      name="add_amount"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                      placeholder="0"
                    />
                  </label>
                </div>
                <label className="qsm-field">
                  <span>{t.covers}</span>
                  <AutoTextarea
                    name="add_desc"
                    rows={2}
                    value={addDesc}
                    onChange={(e) => setAddDesc(e.target.value)}
                    placeholder={t.addCoversPlaceholder}
                    maxLength={2000}
                  />
                </label>
              </fieldset>

              {/* The question a customer staring at two prices actually has.
                  Optional, and off by default. */}
              <div className="qsm-rec">
                <p className="ao-label">{t.recommendLabel}</p>
                <div className="qsm-chips">
                  <button
                    type="button"
                    className={recommend === -1 ? "qsm-chip qsm-chip-on" : "qsm-chip"}
                    aria-pressed={recommend === -1}
                    onClick={() => setRecommend(-1)}
                  >
                    {t.recommendNone}
                  </button>
                  {preview.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      className={recommend === i ? "qsm-chip qsm-chip-on" : "qsm-chip"}
                      aria-pressed={recommend === i}
                      onClick={() => setRecommend(i)}
                    >
                      {`${packageLetter(i)}: ${p.title}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* What is about to be on their phone, priced, in order. The last
                  place anybody can notice that Option B has last week's number
                  on it. */}
              <div className="qsm-preview">
                <p className="ao-label">{fill(t.previewLabel, { name: first })}</p>
                <ul className="qsm-preview-list">
                  {preview.map((p, i) => (
                    <li key={i} className={recommend === i ? "qsm-preview-rec" : undefined}>
                      <span className="qsm-letter">{packageLetter(i)}</span>
                      <span className="ao-opt-title">{p.title}</span>
                      <span className="ao-opt-amount">{dollars(p.amount) ?? "-"}</span>
                    </li>
                  ))}
                </ul>
                <p className="ao-hint">{t.previewNote}</p>
              </div>

              {state.error && !pending && <p className="ao-err">{state.error}</p>}

              <div className="ao-acts">
                <button type="submit" className="ao-go" disabled={!ready || pending}>
                  {pending ? t.sending : fill(t.send, { name: first })}
                </button>
                <button type="button" className="ao-cancel" onClick={() => setOpen(false)} disabled={pending}>
                  {t.cancel}
                </button>
              </div>
              {!ready && <p className="ao-hint">{t.needBoth}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
