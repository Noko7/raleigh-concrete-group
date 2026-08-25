"use client";

import { useActionState } from "react";

import { PhotoUpload } from "@/app/crm/photo-upload";
import { completeJob } from "./actions";
import type { FinishState } from "./types";

// The owner's own "mark completed" button. Same server action the crew's job
// page calls, so the before/after requirement holds here too - an owner
// closing a job out from a desk still leaves a record of the work, and the
// uploaders are right here so meeting that requirement doesn't mean chasing
// the contractor for photos they already took.
export function CompleteCard({
  id,
  title,
  hint,
  statusNote,
  statusIsWarning,
  buttonLabel,
  beforeCount,
  afterCount,
}: {
  id: string;
  title: string;
  hint: string;
  statusNote: string;
  statusIsWarning: boolean;
  buttonLabel: string;
  beforeCount: number;
  afterCount: number;
}) {
  const [state, formAction, pending] = useActionState<FinishState, FormData>(completeJob, { ok: false });
  const hasPhotos = beforeCount > 0 && afterCount > 0;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">{title}</h2>
      <p className={statusIsWarning ? "crm-text-danger crm-sm" : "crm-muted crm-sm"}>
        {statusNote} <span className="crm-muted">{hint}</span>
      </p>

      <div className="crm-photo-slots">
        <div>
          <span className={beforeCount > 0 ? "crm-slot-ok" : "crm-slot-todo"}>
            Before{beforeCount > 0 ? ` (${beforeCount})` : ""}
          </span>
          <PhotoUpload quoteId={id} kind="before" label="Add before photos" />
        </div>
        <div>
          <span className={afterCount > 0 ? "crm-slot-ok" : "crm-slot-todo"}>
            After{afterCount > 0 ? ` (${afterCount})` : ""}
          </span>
          <PhotoUpload quoteId={id} kind="after" label="Add after photos" />
        </div>
      </div>

      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="crm-btn crm-btn-primary" disabled={!hasPhotos || pending}>
          {pending ? "Closing out…" : buttonLabel}
        </button>
        {!hasPhotos && (
          <p className="crm-muted crm-sm">Before and after photos are required to close a job out.</p>
        )}
        {state.error && <p className="crm-auth-error">{state.error}</p>}
      </form>
    </div>
  );
}
