"use client";

import { useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";
import { completeJob } from "@/app/crm/quotes/[id]/actions";

// Marking the work done from the job site. Behind a confirm step on purpose:
// it texts the customer a thank-you and a review request, which is not
// something to fire off with a mis-tap while the phone is in a pocket.
export function JobFinish({ id, locale }: { id: string; locale: Locale }) {
  const t = dict(locale);
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="js-card jf-card">
      <h2 className="js-title">{t.contractorJob.finishTitle}</h2>

      {confirming ? (
        <>
          <p className="js-lead">{t.contractorJob.finishConfirm}</p>
          <form action={completeJob}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="js-confirm">
              {t.contractorJob.finishYes}
            </button>
          </form>
          <button type="button" className="jq-cancel" onClick={() => setConfirming(false)}>
            {t.common.cancel}
          </button>
        </>
      ) : (
        <>
          <p className="js-lead">{t.contractorJob.finishLead}</p>
          <button type="button" className="js-confirm" onClick={() => setConfirming(true)}>
            {t.contractorJob.finishTitle}
          </button>
        </>
      )}
    </section>
  );
}
