"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { STATUS_LABELS, STATUSES } from "@/lib/crm/constants";
import { AutoTextarea } from "@/components/auto-textarea";
import { saveQuote } from "./actions";
import type { SaveState } from "./types";

type ContractorOption = { id: string; label: string };

// The job's own facts, apart from the quote: who the customer is called, where
// it sits on the board, which crew has it, and the notes only staff read. It
// posts to the same saveQuote as the quote editor, which only touches the
// fields a form sends, so saving here never rewrites the quote and saving the
// quote never moves the status.
export function JobSettings({
  id,
  contractors,
  initial,
}: {
  id: string;
  contractors: ContractorOption[];
  initial: { name: string; status: string; assigned_to: string | null; internal_notes: string | null };
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveQuote, { ok: false });
  const [name, setName] = useState(initial.name);
  const [status, setStatus] = useState(initial.status);
  const [assigned, setAssigned] = useState(initial.assigned_to ?? "");
  const [notes, setNotes] = useState(initial.internal_notes ?? "");

  // Follow the saved truth when it changes underneath (a send moves the
  // status, the customer approves), so this never shows a stale value.
  const sig = [initial.name, initial.status, initial.assigned_to ?? "", initial.internal_notes ?? ""].join("|");
  useEffect(() => {
    setName(initial.name);
    setStatus(initial.status);
    setAssigned(initial.assigned_to ?? "");
    setNotes(initial.internal_notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const dirty =
    name !== initial.name ||
    status !== initial.status ||
    assigned !== (initial.assigned_to ?? "") ||
    notes !== (initial.internal_notes ?? "");

  return (
    <form action={formAction} className="crm-card jb-settings">
      <h2 className="crm-card-title">Job</h2>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value="save" />

      <div className="jb-settings-row">
        <label className="crm-field">
          <span>Status</span>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="crm-input">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-field">
          <span>Crew</span>
          <select name="assigned_to" value={assigned} onChange={(e) => setAssigned(e.target.value)} className="crm-input">
            <option value="">Unassigned</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The name every later text opens with. Arrives from a web form or a
          phone call, so it is wrong often enough to need fixing here. */}
      <label className="crm-field">
        <span>Customer name</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} className="crm-input" maxLength={120} />
      </label>

      <label className="crm-field">
        <span>Private notes (staff only)</span>
        <AutoTextarea
          name="internal_notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="crm-input"
          placeholder="Gate code, dog in the yard, anything the crew should know."
        />
      </label>

      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-ghost" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.ok && !pending && !dirty && <span className="crm-saved">Saved</span>}
        {state.error && !pending && <span className="crm-auth-error">{state.error}</span>}
      </div>
    </form>
  );
}
