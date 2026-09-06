"use client";

import { useActionState, useState } from "react";

import { METHOD_LABELS, RECORDED_METHODS, fromCents, usd, type PaymentMethod } from "@/lib/crm/fees";
import { recordFeeSettlement, type SettleState } from "./actions";

const initial: SettleState = { ok: false };

/**
 * "Mike sent me $1,240 on Zelle."
 *
 * Folded away until it is needed, and seeded with exactly what that person
 * owes - the overwhelmingly common case is somebody clearing their balance in
 * full, and making the office type a figure it already knows is how the number
 * on this page slowly stops matching the bank.
 */
export function SettleForm({
  contractors,
}: {
  contractors: { staffId: string; name: string; balanceCents: number }[];
}) {
  const [state, action, pending] = useActionState(recordFeeSettlement, initial);
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState(contractors[0]?.staffId ?? "");
  const [method, setMethod] = useState<PaymentMethod>("zelle");

  const picked = contractors.find((c) => c.staffId === staffId);

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
            <span>How much</span>
            <input
              className="crm-input"
              name="amount"
              type="text"
              inputMode="decimal"
              // Keyed on the person so switching contractor reseeds the figure
              // rather than leaving the last one's balance in the box.
              key={staffId}
              defaultValue={picked ? String(fromCents(picked.balanceCents)) : ""}
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
