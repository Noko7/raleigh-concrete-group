"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "choose" | "submitting" | "confirmed" | "reschedule";

export function ConfirmActions({ token }: { token: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState("");

  async function submit(action: "confirm" | "reschedule") {
    setError("");
    setMode("submitting");
    try {
      const res = await fetch("/api/confirm-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMode(action === "confirm" ? "confirmed" : "reschedule");
        router.refresh();
      } else {
        setError(json.error || "Something went wrong. Please call us.");
        setMode("choose");
      }
    } catch {
      setError("Something went wrong. Please call us.");
      setMode("choose");
    }
  }

  if (mode === "confirmed") {
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">Confirmed</p>
        <h3>You&apos;re all set. See you then.</h3>
        <p className="cq-result-note">Thanks for confirming. We&apos;ll be in touch if anything comes up.</p>
      </div>
    );
  }

  if (mode === "reschedule") {
    return (
      <div className="cq-result">
        <p className="cq-result-eyebrow">Got it</p>
        <h3>We&apos;ll reach out to reschedule</h3>
        <p className="cq-result-note">No problem. We&apos;ll call you shortly to find a better day.</p>
      </div>
    );
  }

  const busy = mode === "submitting";
  return (
    <div className="cq-cta cq-cta-stack">
      <button type="button" className="cq-btn cq-btn-accept" disabled={busy} onClick={() => submit("confirm")}>
        {busy ? "One moment…" : "Yes, confirm my job"}
      </button>
      <button type="button" className="cq-btn cq-btn-secondary" disabled={busy} onClick={() => submit("reschedule")}>
        I need to reschedule
      </button>
      {error && <p className="cq-fine cq-error">{error}</p>}
    </div>
  );
}
