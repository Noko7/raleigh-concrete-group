"use client";

import { useActionState } from "react";

import { PhotoUpload } from "@/app/crm/photo-upload";
import { completeJob } from "./status-actions";
import type { FinishState } from "./types";

// Same server action as the crew's page, so the before/after photo requirement holds for owners too.
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
