"use client";

import { useActionState, useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { completeJob } from "@/app/crm/quotes/[id]/actions";
import type { FinishState } from "@/app/crm/quotes/[id]/types";
import { PhotoUpload } from "@/app/crm/photo-upload";
import { AutoTextarea } from "@/components/auto-textarea";

// What causes callbacks when skipped, in the order a crew does them. Names match the server's values.
// Photos aren't a box: the server refuses to close the job without the uploads.
const CHECKS = ["work", "clean", "customer"] as const;
type Check = (typeof CHECKS)[number];

// Marking done texts the customer a thank-you and review request, so it's not a one-tap action. The
// checklist is a prompt, not a gate.
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

      {/* Outside the form: a file input inside it would submit with it. */}
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
          <AutoTextarea name="note" rows={3} maxLength={1000} placeholder={t.contractorJob.finishNotePlaceholder} />
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
