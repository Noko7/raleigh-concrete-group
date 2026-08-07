"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { dict, type Locale } from "@/lib/crm/i18n";
import { setNewPassword } from "./reset/actions";
import type { ResetState } from "./reset/types";

export function ForceReset({ locale = "en" }: { locale?: Locale }) {
  const t = dict(locale);
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ResetState, FormData>(setNewPassword, { ok: false });

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <main className="crm-page crm-page-narrow">
      <div className="crm-card">
        <h1 className="crm-card-title">{t.reset.title}</h1>
        <p className="crm-muted crm-sm" style={{ marginBottom: "1rem" }}>
          {t.reset.subtitle}
        </p>
        <form action={formAction} className="crm-editor">
          <label className="crm-field">
            <span>{t.reset.newPassword}</span>
            <input name="password" type="password" className="crm-input" autoComplete="new-password" minLength={8} required />
          </label>
          <label className="crm-field">
            <span>{t.reset.confirm}</span>
            <input name="confirm" type="password" className="crm-input" autoComplete="new-password" minLength={8} required />
          </label>
          <div className="crm-editor-foot">
            <button type="submit" className="crm-btn crm-btn-primary" disabled={pending}>
              {pending ? t.reset.submitting : t.reset.submit}
            </button>
            {state.error && <span className="crm-auth-error">{state.error}</span>}
          </div>
        </form>
      </div>
    </main>
  );
}
