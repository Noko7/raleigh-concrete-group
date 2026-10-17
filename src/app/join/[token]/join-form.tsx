"use client";

import { useState } from "react";

import { dict, type Locale } from "@/lib/crm/i18n";

// Editable: the owner may only have the number they were given. Redeeming the link already creates the
// account, so choosing the alert number adds no attack surface.
function prettyPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}

// Mirrors the server's toE164 for a fast answer.
function looksLikeUsPhone(raw: string): boolean {
  const t = raw.trim();
  if (t.startsWith("+")) {
    const cleaned = t.slice(1).replace(/\D/g, "");
    return cleaned.length >= 11 && cleaned.length <= 15;
  }
  const d = t.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
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
  const locale: Locale = "en";
  const t = dict(locale);
  const [fullName, setFullName] = useState(defaultName);
  const [alertPhone, setAlertPhone] = useState(prettyPhone(phone));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // The server re-checks all of it.
    if (fullName.trim().length < 2) return setError(t.join.needName);
    if (!looksLikeUsPhone(alertPhone)) return setError(t.join.badPhone);
    if (password.length < 8) return setError(t.join.needPassword);
    if (password !== confirm) return setError(t.join.mismatch);

    setBusy(true);
    try {
      const res = await fetch("/api/contractor-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, email, password, locale, phone: alertPhone }),
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

      <label className="join-field">
        <span>{t.join.phone}</span>
        <input
          type="tel"
          inputMode="tel"
          value={alertPhone}
          onChange={(e) => setAlertPhone(e.target.value)}
          autoComplete="tel"
          placeholder="(919) 555-1234"
          required
        />
      </label>
      <p className="join-note">{t.join.phoneHint}</p>

      {error && <p className="cq-err">{error}</p>}

      <button type="submit" className="cq-btn cq-btn-accept join-submit" disabled={busy}>
        {busy ? t.join.creating : t.join.create}
      </button>
    </form>
  );
}
