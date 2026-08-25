"use client";

import { useActionState, useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { completeJob } from "@/app/crm/quotes/[id]/actions";
import type { FinishState } from "@/app/crm/quotes/[id]/types";
import { PhotoUpload } from "@/app/crm/photo-upload";

// The three things that cause a callback when they're skipped, in the order a
// crew actually does them. Names match the values the server records.
//
// "Photos taken" used to be the fourth box. It isn't a box any more: the
// before and after shots are uploaded here and the server refuses to close the
// job without them, so ticking a checkbox to say they exist would be asking
// someone to confirm something the page can already see.
const CHECKS = ["work", "clean", "customer"] as const;
type Check = (typeof CHECKS)[number];

// Marking the work done texts the customer a thank you and a review request, so
// it isn't something to fire off with a mis-tap while the phone is in a pocket.
// The checklist is the deliberate step: it's a prompt, not a gate, but it puts
// "did you clean up" in front of someone before they close the job rather than
// after the customer calls about it.
export function JobFinish({
  id,
  locale,
  beforeCount,
  afterCount,
}: {
  id: string;
  locale: Locale;
  beforeCount: number;
  afterCount: number;
}) {
  const t = dict(locale);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FinishState, FormData>(completeJob, { ok: false });
  const [ticked, setTicked] = useState<Record<Check, boolean>>({
    work: false,
    clean: false,
    customer: false,
  });

  const label: Record<Check, string> = {
    work: t.contractorJob.checkWork,
    clean: t.contractorJob.checkClean,
    customer: t.contractorJob.checkCustomer,
  };

  const allTicked = CHECKS.every((c) => ticked[c]);
  const hasPhotos = beforeCount > 0 && afterCount > 0;

  if (!open) {
    return (
      <section className="js-card jf-card">
        <h2 className="js-title">{t.contractorJob.finishTitle}</h2>
        <p className="js-lead">{t.contractorJob.finishLead}</p>
        <button type="button" className="js-confirm" onClick={() => setOpen(true)}>
          {t.contractorJob.finishTitle}
        </button>
      </section>
    );
  }

  return (
    <section className="js-card jf-card">
      <h2 className="js-title">{t.contractorJob.finishTitle}</h2>

      {/* Outside the form on purpose: uploading is its own round trip, and a
          file input inside the close-out form would submit with it. */}
      <div className="jf-photos">
        <p className="js-lead">{t.contractorJob.photosRequired}</p>
        <div className="jf-photo-row">
          <div className="jf-photo-slot">
            <span className={beforeCount > 0 ? "jf-photo-ok" : "jf-photo-todo"}>
              {beforeCount > 0 ? `${t.contractorJob.photosBefore} (${beforeCount})` : t.contractorJob.photosBefore}
            </span>
            <PhotoUpload quoteId={id} kind="before" label={t.contractorJob.photosAdd} light />
          </div>
          <div className="jf-photo-slot">
            <span className={afterCount > 0 ? "jf-photo-ok" : "jf-photo-todo"}>
              {afterCount > 0 ? `${t.contractorJob.photosAfter} (${afterCount})` : t.contractorJob.photosAfter}
            </span>
            <PhotoUpload quoteId={id} kind="after" label={t.contractorJob.photosAdd} light />
          </div>
        </div>
      </div>

      <form action={formAction}>
        <input type="hidden" name="id" value={id} />

        <p className="js-lead">{t.contractorJob.finishChecklist}</p>
        <ul className="jf-checks">
          {CHECKS.map((c) => (
            <li key={c}>
              <label className="jf-check">
                <input
                  type="checkbox"
                  name="check"
                  value={c}
                  checked={ticked[c]}
                  onChange={(e) => setTicked((s) => ({ ...s, [c]: e.target.checked }))}
                />
                <span>{label[c]}</span>
              </label>
            </li>
          ))}
        </ul>

        <label className="jf-note">
          <span>{t.contractorJob.finishNote}</span>
          <textarea name="note" rows={3} maxLength={1000} placeholder={t.contractorJob.finishNotePlaceholder} />
        </label>

        <p className="js-hint jf-warn">{t.contractorJob.finishConfirm}</p>

        <button type="submit" className="js-confirm" disabled={!allTicked || !hasPhotos || pending}>
          {pending ? t.contractorJob.finishSaving : t.contractorJob.finishYes}
        </button>
        {!hasPhotos && <p className="js-hint">{t.contractorJob.photosRequiredHint}</p>}
        {hasPhotos && !allTicked && <p className="js-hint">{t.contractorJob.finishAllRequired}</p>}
        {state.error && <p className="js-err">{state.error}</p>}

        <button type="button" className="jq-cancel" onClick={() => setOpen(false)} disabled={pending}>
          {t.common.cancel}
        </button>
      </form>
    </section>
  );
}
