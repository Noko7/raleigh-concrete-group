"use client";

import { useActionState, useState } from "react";

import { METHOD_LABELS, RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { recordFeeSettlement, type SettleState } from "./actions";

const initial: SettleState = { ok: false };

/**
 * "Mike sent me $600 on Zelle for Dave Allmon's job."
 *
 * Recorded against the job it was for, so the ledger reads by job and each
 * job shows what's been sent on it - half from the deposit, half at the end.
 * Folded away until it is needed, and seeded with exactly what that person
 * owes - the overwhelmingly common case is somebody clearing their balance in
 * full, and making the office type a figure it already knows is how the number
 * on this page slowly stops matching the bank.
 */
export function SettleForm({
  contractors,
}: {
  contractors: {
    staffId: string;
    name: string;
    balanceCents: number;
    /** Their jobs with fee still owed on them, so the payment lands on the job it was for. */
    jobs: { id: string; name: string; owedCents: number }[];
  }[];
}) {
  const [state, action, pending] = useActionState(recordFeeSettlement, initial);
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState(contractors[0]?.staffId ?? "");
  const [method, setMethod] = useState<PaymentMethod>("zelle");

  const picked = contractors.find((c) => c.staffId === staffId);
  // The job it was for. Defaults to the one owing most, which is almost always
  // the one they're paying; "" is a lump sum across their balance.
  const [jobPick, setJobPick] = useState<{ staffId: string; jobId: string } | null>(null);
  const jobId =
    jobPick && jobPick.staffId === staffId ? jobPick.jobId : (picked?.jobs[0]?.id ?? "");
  const pickedJob = picked?.jobs.find((j) => j.id === jobId);
  const seed = pickedJob ? pickedJob.owedCents : (picked?.balanceCents ?? 0);

  if (contractors.length === 0) return null;

  return (
    <div className="cash-settle">
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Close" : "Record a fee payment"}
      </button>

      {open && (
        <form action={action} className="cash-settle-form">
          <label className="crm-field">
            <span>Who paid you</span>
            <select
              className="crm-input"
              name="staff_id"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              disabled={pending}
            >
              {contractors.map((c) => (
                <option key={c.staffId} value={c.staffId}>
                  {c.name} - {usd(c.balanceCents)} owed
                </option>
              ))}
            </select>
          </label>

          <label className="crm-field">
            <span>For which job</span>
            <select
              className="crm-input"
              name="quote_id"
              value={jobId}
              onChange={(e) => setJobPick({ staffId, jobId: e.target.value })}
              disabled={pending}
            >
              {(picked?.jobs ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} - {usd(j.owedCents)} owed
                </option>
              ))}
              <option value="">Not for one job (lump sum)</option>
            </select>
          </label>

          <label className="crm-field">
            <span>How much</span>
            <input
              className="crm-input"
              name="amount"
              type="text"
              inputMode="decimal"
              // Keyed on the person so switching contractor reseeds the figure
              // rather than leaving the last one's balance in the box.
              key={`${staffId}:${jobId}`}
              defaultValue={seed > 0 ? String(fromCents(seed)) : ""}
              autoComplete="off"
              disabled={pending}
            />
          </label>

          <label className="crm-field">
            <span>How</span>
            <select
              className="crm-input"
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              disabled={pending}
            >
              {RECORDED_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="crm-field cash-settle-note">
            <span>Note (optional)</span>
            <input className="crm-input" name="note" type="text" maxLength={500} disabled={pending} />
          </label>

          <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Record it"}
          </button>
        </form>
      )}

      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.message && <p className="crm-saved">{state.message}</p>}
    </div>
  );
}
