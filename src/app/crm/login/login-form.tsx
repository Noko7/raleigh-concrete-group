"use client";

import { useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";

export function LoginForm({ base, next, locale = "en" }: { base: string; next?: string; locale?: Locale }) {
  const t = dict(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        window.location.href = next || `${base}/`;
        return;
      }
      setError(json.error || t.login.failed);
    } catch {
      setError(t.login.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="crm-auth-form" onSubmit={onSubmit}>
      <label className="crm-field">
        <span>{t.login.email}</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="crm-field">
        <span>{t.login.password}</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="crm-auth-error">{error}</p>}
      <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
        {busy ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}
