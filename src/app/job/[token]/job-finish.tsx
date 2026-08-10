"use client";

import { useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { completeJob } from "@/app/crm/quotes/[id]/actions";

// The four things that cause a callback when they're skipped, in the order a
// crew actually does them. Names match the values the server records.
const CHECKS = ["work", "clean", "customer", "photos"] as const;
type Check = (typeof CHECKS)[number];

// Marking the work done texts the customer a thank you and a review request, so
// it isn't something to fire off with a mis-tap while the phone is in a pocket.
// The checklist is the deliberate step: it's a prompt, not a gate, but it puts
// "did you clean up" in front of someone before they close the job rather than
// after the customer calls about it.
export function JobFinish({ id, locale }: { id: string; locale: Locale }) {
  const t = dict(locale);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Record<Check, boolean>>({
    work: false,
    clean: false,
    customer: false,
    photos: false,
  });

  const label: Record<Check, string> = {
    work: t.contractorJob.checkWork,
    clean: t.contractorJob.checkClean,
    customer: t.contractorJob.checkCustomer,
    photos: t.contractorJob.checkPhotos,
  };

  const allTicked = CHECKS.every((c) => ticked[c]);

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

      <form action={completeJob}>
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

        <button type="submit" className="js-confirm" disabled={!allTicked}>
          {t.contractorJob.finishYes}
        </button>
        {!allTicked && <p className="js-hint">{t.contractorJob.finishAllRequired}</p>}

        <button type="button" className="jq-cancel" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </button>
      </form>
    </section>
  );
}
