"use client";

import { useActionState } from "react";

import { saveOnlineCardPayments } from "./actions";
import type { SaveState } from "./types";

const initial: SaveState = { ok: true };

// The owner's switch for online card payments (Stripe) across the whole site.
export function CardPaymentsForm({ on, stripeReady }: { on: boolean; stripeReady: boolean }) {
  const [state, formAction, pending] = useActionState(saveOnlineCardPayments, initial);

  return (
    <form action={formAction} className="crm-card crm-settings">
      <h2 className="crm-card-title">Online card payments (Stripe)</h2>
      <p className="crm-muted crm-sm">
        {on
          ? "On: customers can pay deposits and balances by card on the site, and crews can text card links."
          : "Off: no card checkout or card links anywhere. Customers pay the contractor directly, and you can still refund earlier card payments."}
      </p>
      {!stripeReady && <p className="crm-muted crm-sm">Stripe keys aren&apos;t set in Vercel, so card payments can&apos;t run even when this is on.</p>}

      <label className="crm-check">
        <input type="checkbox" name="online_card_payments" defaultChecked={on} />
        <span>Let customers pay by card online</span>
      </label>

      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.saved && !state.error && <p className="crm-saved">Saved.</p>}

      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
