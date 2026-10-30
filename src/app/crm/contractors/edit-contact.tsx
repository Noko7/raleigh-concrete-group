"use client";

import { useActionState, useEffect, useState } from "react";

import { quoteServiceOptions } from "@/lib/site-data";
import { updateContractorContact } from "./actions";
import type { ContactState } from "./types";

// What an owner can change without involving the contractor. Password is Reset password; active is the
// row's own button.
export function EditContact({
  id,
  name,
  email,
  phone,
  serviceTypes,
  businessName,
  businessAddress,
}: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  serviceTypes: string[];
  businessName: string | null;
  businessAddress: string | null;
}) {
  const [state, formAction, pending] = useActionState<ContactState, FormData>(updateContractorContact, { ok: false });
  const [open, setOpen] = useState(false);

  // Close once saved; the row already shows the new values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  if (!open) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(true)}>
        Edit details
      </button>
    );
  }

  return (
    <form action={formAction} className="crm-editor contact-form">
      <input type="hidden" name="id" value={id} />
      <label className="crm-field">
        <span>Name</span>
        <input name="full_name" className="crm-input" defaultValue={name} />
      </label>
      <label className="crm-field">
        <span>Email (their login)</span>
        <input name="email" type="email" className="crm-input" defaultValue={email} required />
      </label>
      <label className="crm-field">
        <span>Alert number</span>
        <input
          name="phone"
          type="tel"
          className="crm-input"
          defaultValue={phone ?? ""}
          placeholder="(919) 555-1234"
        />
      </label>
      {/* Printed on every receipt for a payment their customers make to them. */}
      <label className="crm-field">
        <span>Business name (on receipts)</span>
        <input
          name="business_name"
          className="crm-input"
          defaultValue={businessName ?? ""}
          maxLength={120}
          placeholder="e.g. Smith Concrete LLC"
        />
      </label>
      <label className="crm-field">
        <span>Business address (on receipts)</span>
        <input
          name="business_address"
          className="crm-input"
          defaultValue={businessAddress ?? ""}
          maxLength={300}
          placeholder="Street, city, state ZIP"
        />
      </label>
      <p className="crm-muted crm-sm">
        Customers pay the contractor, so their receipts name this business as paid. Blank uses their name. A change
        only affects receipts issued after it.
      </p>
      {/*
        Nothing ticked = no restriction: a lead is never dropped for want of a rule, it falls through to the
        primary contractor.
      */}
      <fieldset className="crm-sections">
        <legend>Job types they take</legend>
        <p className="crm-muted crm-sm">
          New leads for these services go to this contractor. Leave them all unticked to let anything route here.
        </p>
        <div className="svc-grid">
          {quoteServiceOptions.map((svc) => (
            <label key={svc} className="svc-check">
              <input type="checkbox" name="service_types" value={svc} defaultChecked={serviceTypes.includes(svc)} />
              <span>{svc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="crm-muted crm-sm">
        Changing the email changes what they sign in with, so tell them or their old address stops working. Leave the
        number blank to stop texting them job alerts.
      </p>
      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
    </form>
  );
}
