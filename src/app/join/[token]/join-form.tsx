"use client";

import { useState } from "react";

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
    if (fullName.trim().length < 2) return setError("Enter your full name.");
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");

    setBusy(true);
    try {
      const res = await fetch("/api/contractor-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, full_name: fullName, email, password }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setDone(true);
        return;
      }
      setError(json.error || "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">You&apos;re all set</p>
        <h3>Your account is ready</h3>
        <p className="cq-result-note">Sign in with {email} and the password you just chose.</p>
        <a className="cq-btn cq-btn-accept join-signin" href="/crm">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form className="join-form" onSubmit={onSubmit}>
      <label className="join-field">
        <span>Full name</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
      </label>

      <label className="join-field">
        <span>Email (this is your username)</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="join-field">
        <span>Password (8+ characters)</span>
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
        <span>Confirm password</span>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>

      <p className="join-note">
        Job alerts will be texted to <strong>{prettyPhone(phone)}</strong>. Ask the owner if that&apos;s not your
        number.
      </p>

      {error && <p className="cq-err">{error}</p>}

      <button type="submit" className="cq-btn cq-btn-accept join-submit" disabled={busy}>
        {busy ? "Creating your account…" : "Create my account"}
      </button>
    </form>
  );
}
