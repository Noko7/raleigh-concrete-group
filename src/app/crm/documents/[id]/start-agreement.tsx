"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startAgreementAction } from "./agreement-actions";

// No agreement written in the CRM yet: one tap drafts version 1 from the job.
export function StartAgreement({ quoteId }: { quoteId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="ae-start">
      <p className="crm-muted crm-sm">
        Drafts the agreement from this job: the customer, the contractor, the approved work and the price. You can edit
        every section before it goes out, and every save is kept as a version.
      </p>
      <button
        type="button"
        className="crm-btn crm-btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startAgreementAction(quoteId);
            if (r.ok) router.refresh();
            else setError(r.error ?? "Couldn't start the agreement.");
          })
        }
      >
        {pending ? "Drafting…" : "Write the agreement"}
      </button>
      {error && <p className="jr-err" role="alert">{error}</p>}
    </div>
  );
}
