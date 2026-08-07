"use client";

import { useState } from "react";

import { dict, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/crm/i18n";

// Shows the number the owner invited so the contractor can see where their job
// texts will go, but it isn't editable - it comes from the invite, not the form,
// so this page can't be used to point alerts at a different phone.
function prettyPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}

export function JoinForm({
  token,
  defaultName,
  phone,
}: {
  token: string;
  defaultName: string;
  phone: string;
}) {
  // Chosen before the account exists, then saved as their CRM language - so a
  // Spanish-speaking contractor never sees an English screen, not even this one.
  const [locale, setLocale] = useState<Locale>("en");
  const t = dict(locale);
  const [fullName, setFullName] = useState(defaultName);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Check what we can here for a fast answer; the server re-checks all of it.
    if (fullName.trim().length < 2) return setError(t.join.needName);
    if (password.length < 8) return setError(t.join.needPassword);
    if (password !== confirm) return setError(t.join.mismatch);

    setBusy(true);
    try {
      const res = await fetch("/api/contractor-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, email, password, locale }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setDone(true);
        return;
      }
      setError(json.error || t.common.error);
    } catch {
      setError(t.login.network);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">{t.join.doneEyebrow}</p>
        <h3>{t.join.doneTitle}</h3>
        <p className="cq-result-note">{t.join.doneNote} {email}</p>
        <a className="cq-btn cq-btn-accept join-signin" href="/crm">
          {t.join.goSignIn}
        </a>
      </div>
    );
  }

  return (
    <form className="join-form" onSubmit={onSubmit}>
      <label className="join-field">
        <span>{t.join.language}</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>

      <label className="join-field">
        <span>{t.join.fullName}</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
      </label>

      <label className="join-field">
        <span>{t.join.email}</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="join-field">
        <span>{t.join.password}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>

      <label className="join-field">
        <span>{t.join.confirm}</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>

      <p className="join-note">
        {t.join.phoneNote} <strong>{prettyPhone(phone)}</strong>
      </p>

      {error && <p className="cq-err">{error}</p>}

      <button type="submit" className="cq-btn cq-btn-accept join-submit" disabled={busy}>
        {busy ? t.join.creating : t.join.create}
      </button>
    </form>
  );
}
