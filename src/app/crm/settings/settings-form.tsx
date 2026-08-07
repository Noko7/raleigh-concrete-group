"use client";

import { useActionState } from "react";

import { dict, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/crm/i18n";
import { saveSettings } from "./actions";
import type { SaveState } from "./types";

type Props = {
  fullName: string;
  phone: string;
  email: string;
  role: "owner" | "contractor";
  locale: Locale;
};

const initial: SaveState = { ok: true };

export function SettingsForm({ fullName, phone, email, role, locale }: Props) {
  const [state, formAction, pending] = useActionState(saveSettings, initial);
  const t = dict(locale);

  return (
    <form action={formAction} className="crm-card crm-settings">
      <div className="crm-settings-head">
        <div>
          <div className="crm-settings-email">{email || "No email on file"}</div>
          <span className={`crm-badge crm-badge-${role === "owner" ? "owner" : "contractor"}`}>
            {role === "owner" ? t.nav.owner : t.nav.contractor}
          </span>
        </div>
      </div>

      <label className="crm-field">
        <span>{t.settings.yourName}</span>
        <input className="crm-input" name="full_name" defaultValue={fullName} maxLength={120} autoComplete="name" />
      </label>

      <label className="crm-field">
        <span>{t.settings.language}</span>
        <select className="crm-input" name="locale" defaultValue={locale}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
        <small className="crm-muted crm-sm">{t.settings.languageHint}</small>
      </label>

      <label className="crm-field">
        <span>{t.settings.alertNumber}</span>
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
      {state.saved && !state.error && <p className="crm-saved">{t.settings.saved}</p>}

      <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
        {pending ? t.settings.saving : t.settings.save}
      </button>
    </form>
  );
}
