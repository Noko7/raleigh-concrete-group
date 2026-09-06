"use client";

import { useActionState, useState } from "react";

import { linkStripeAccount, refreshStripeAccount, type StripeLinkState } from "./stripe-actions";

const initial: StripeLinkState = { ok: false };

/**
 * Whether this contractor can be paid by card, and what to do about it if not.
 *
 * The states are deliberately three, not two. "Linked" and "can take money" are
 * different facts - an account can be attached and still be mid-review - and
 * collapsing them is how an office sends a customer a payment link that dies on
 * open. Each state says what it is and what the next action is, in that order.
 *
 * The account ID is behind a disclosure rather than sitting in the table:
 * linking happens once per contractor, and a field nobody touches for months
 * shouldn't take up a column that gets read every day.
 */
export function StripePayee({
  staffId,
  name,
  accountId,
  chargesEnabled,
  detailsSubmitted,
}: {
  staffId: string;
  name: string;
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}) {
  const [linkState, linkAction, linking] = useActionState(linkStripeAccount, initial);
  const [refreshState, refreshAction, refreshing] = useActionState(refreshStripeAccount, initial);
  const [open, setOpen] = useState(false);

  const state = !accountId ? "none" : chargesEnabled ? "ready" : "pending";
  const feedback = linkState.error || refreshState.error || linkState.message || refreshState.message;
  const isError = Boolean(linkState.error || refreshState.error);

  return (
    <div className="sp">
      {state === "ready" && <span className="crm-badge crm-badge-won">Card ready</span>}
      {state === "pending" && (
        <span className="crm-badge crm-badge-warning" title="Linked, but Stripe won't let them take payments yet">
          {detailsSubmitted ? "In review" : "Unfinished"}
        </span>
      )}
      {state === "none" && <span className="crm-muted crm-sm">Cash only</span>}

      <button type="button" className="sp-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Close" : accountId ? "Change" : "Link Stripe"}
      </button>

      {open && (
        <div className="sp-panel">
          {/* The reason this exists, said once, where somebody is about to do
              it. An owner links an account roughly five times ever, so the
              instructions have to travel with the field. */}
          <p className="crm-muted crm-sm">
            Create an Express account for {name} in the Stripe Dashboard, send them the onboarding link, then paste
            the account ID here.
          </p>

          <form action={linkAction} className="sp-form">
            <input type="hidden" name="staff_id" value={staffId} />
            <label className="crm-field">
              <span>Stripe account ID</span>
              <input
                className="crm-input sp-input"
                name="stripe_account_id"
                defaultValue={accountId ?? ""}
                placeholder="acct_1A2b3C4d5E6f7G8h"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="sp-actions">
              <button type="submit" className="crm-btn crm-btn-primary" disabled={linking}>
                {linking ? "Checking with Stripe…" : "Save"}
              </button>
              {accountId && (
                <button
                  type="submit"
                  formAction={refreshAction}
                  className="crm-btn crm-btn-ghost"
                  disabled={refreshing}
                >
                  {refreshing ? "Checking…" : "Re-check status"}
                </button>
              )}
            </div>
            {accountId && (
              <p className="crm-muted crm-sm">Clear the field and save to stop sending them card payments.</p>
            )}
          </form>

          {feedback && <p className={isError ? "crm-auth-error" : "crm-saved"}>{feedback}</p>}
        </div>
      )}
    </div>
  );
}
