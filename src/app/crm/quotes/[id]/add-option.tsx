"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SpellInput, SpellTextarea } from "@/components/spell-field";
import { firstNameOf, dollars, PACKAGE_TITLE_MAX, packageLetter } from "@/lib/crm/constants";
import { dict, fill, type Locale } from "@/lib/crm/i18n";
import { addQuoteOption } from "./save-actions";
import type { SaveState } from "./types";

// "They said it's too much. Send them the asphalt price as well."
//
// One modal, opened from Quotes sent, that turns the flat price into Option A,
// adds Option B and sends, instead of four screens of the quote editor while
// the customer is on the phone. Their link shows both as soon as it lands.
//
// One component, two tones (dark office page, white crew card), so one copy of
// a fiddly form.

export type SentOption = { id: string; title: string; amount: number; recommended: boolean };

export function AddOption({
  quoteId,
  customerName,
  // The customer's current price; Option A's price the first time, editable.
  currentAmount,
  // The job's service, e.g. "Concrete Driveways": only a guess at a name for the
  // existing quote, shown editable, never written on their behalf.
  service,
  // Options already on the quote. Usually empty: one flat price becoming Option A.
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
  const first = firstNameOf(customerName, customerName);
  // Already a choice: adding another; existing ones shown as context.
  const converting = options.length === 0;

  // The service minus a trailing "s" ("Concrete Driveways" -> "Concrete
  // Driveway"). Only a starting point.
  const guess = (service ?? "").trim().replace(/s$/i, "");
  const [keepTitle, setKeepTitle] = useState(guess);
  const [keepAmount, setKeepAmount] = useState(currentAmount != null ? String(currentAmount) : "");
  const [keepDesc, setKeepDesc] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDesc, setAddDesc] = useState("");
  // The crew's pick, as an index into the customer's list; -1 is none. Seeded
  // from the quote: the server rewrites every card's flag from this number, so
  // starting at -1 would silently strip an existing recommendation.
  const [recommend, setRecommend] = useState(() => options.findIndex((o) => o.recommended));

  // Escape closes, and the page behind stops scrolling (as in the gallery lightbox).
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

  // Sent: close and refresh so the new line shows in Quotes sent.
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

  // What the customer will see, in order; built here so it can't drift from the save.
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
        {/* Outside the modal, since a send closes it. A held text isn't a failure. */}
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
          {/* Stop clicks reaching the backdrop, or every tap closes the form. */}
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
              {/* Editable on the first pass: the service name is a guess and the
                  customer will read it. */}
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
                      <SpellInput
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
                    <SpellTextarea
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
                    <SpellInput
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
                  <SpellTextarea
                    name="add_desc"
                    rows={2}
                    value={addDesc}
                    onChange={(e) => setAddDesc(e.target.value)}
                    placeholder={t.addCoversPlaceholder}
                    maxLength={2000}
                  />
                </label>
              </fieldset>

              {/* "Which would you pick?" Optional, off by default. */}
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

              {/* What will be on their phone, priced and in order: the last chance
                  to spot a stale price. */}
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
