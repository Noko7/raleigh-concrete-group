"use client";

import { useActionState } from "react";

import { saveSettings } from "./actions";
import type { SaveState } from "./types";

type Props = {
  fullName: string;
  phone: string;
  email: string;
  role: "owner" | "contractor";
};

const initial: SaveState = { ok: true };

export function SettingsForm({ fullName, phone, email, role }: Props) {
  const [state, formAction, pending] = useActionState(saveSettings, initial);

  return (
    <form action={formAction} className="crm-card crm-settings">
      <div className="crm-settings-head">
        <div>
          <div className="crm-settings-email">{email || "No email on file"}</div>
          <span className={`crm-badge crm-badge-${role === "owner" ? "won" : "assigned"}`}>
            {role === "owner" ? "Owner" : "Contractor"}
          </span>
        </div>
      </div>

      <label className="crm-field">
        <span>Your name</span>
        <input className="crm-input" name="full_name" defaultValue={fullName} maxLength={120} autoComplete="name" />
      </label>

      <label className="crm-field">
        <span>Mobile number for text alerts</span>
        <input
          className="crm-input"
          name="phone"
          defaultValue={phone}
          type="tel"
          inputMode="tel"
          placeholder="(919) 555-1234"
          autoComplete="tel"
        />
        <small className="crm-muted crm-sm">
          {role === "owner"
            ? "Owners get a text for every new lead and every job update."
            : "You'll get a text when a job is assigned to you."}{" "}
          Leave blank to turn texts off.
        </small>
      </label>

      {state.error && <p className="crm-auth-error">{state.error}</p>}
      {state.saved && !state.error && <p className="crm-saved">Saved.</p>}

      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
