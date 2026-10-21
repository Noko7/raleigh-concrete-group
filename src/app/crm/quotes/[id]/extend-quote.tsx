"use client";

import { useActionState } from "react";

import { BUSINESS_TZ } from "@/lib/crm/clock";
import { extendQuote } from "./send-actions";
import type { ScheduleState } from "./types";

// How long the customer's quote link stays open, and three buttons to push it out. Nobody is texted.
export function ExtendQuote({ id, expiresAt }: { id: string; expiresAt: string | null }) {
  const [state, formAction, pending] = useActionState<ScheduleState, FormData>(extendQuote, { ok: false });
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  const day = expiresAt
    ? new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: BUSINESS_TZ })
    : null;

  return (
    <div className="crm-card">
      <h2 className="crm-card-title">Quote lifetime</h2>
      <p className="crm-sm">
        {!day ? (
          "This quote has no expiry date."
        ) : expired ? (
          <>
            Expired <strong className="crm-link-strong">{day}</strong>. Extend it to let the customer open it again.
          </>
        ) : (
          <>
            Good through <strong className="crm-link-strong">{day}</strong>.
          </>
        )}
      </p>
      <form action={formAction} className="crm-editor-foot">
        <input type="hidden" name="id" value={id} />
        <span className="crm-muted crm-sm">Extend to:</span>
        {[30, 60, 90].map((d) => (
          <button key={d} type="submit" name="days" value={d} className="crm-btn crm-btn-ghost" disabled={pending}>
            {d} days
          </button>
        ))}
      </form>
      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.ok && state.message && <p className="crm-muted crm-sm">{state.message}</p>}
    </div>
  );
}
