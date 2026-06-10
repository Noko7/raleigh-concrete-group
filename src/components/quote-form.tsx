"use client";

import { useState } from "react";
import { services } from "@/lib/site-data";

type Status = "idle" | "sending" | "success" | "error";

// Set NEXT_PUBLIC_FORM_ENDPOINT (e.g. a Formspree URL) in Vercel to receive
// real submissions. Without it the form runs in friendly demo mode.
const ENDPOINT = process.env.NEXT_PUBLIC_FORM_ENDPOINT ?? "";

export function QuoteForm({ defaultCity }: { defaultCity?: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    if (!ENDPOINT) {
      setStatus("success");
      form.reset();
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      setStatus(res.ok ? "success" : "error");
      if (res.ok) form.reset();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="quote-form">
      <div className="qf-row">
        <label className="qf-field">
          <span>Name</span>
          <input name="name" autoComplete="name" required />
        </label>
        <label className="qf-field">
          <span>Phone</span>
          <input name="phone" type="tel" autoComplete="tel" required />
        </label>
      </div>
      <div className="qf-row">
        <label className="qf-field">
          <span>Service</span>
          <select name="service" defaultValue="" required>
            <option value="" disabled>
              Choose one…
            </option>
            {services.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
            <option value="Something else">Something else</option>
          </select>
        </label>
        <label className="qf-field">
          <span>Property address</span>
          <input
            name="address"
            autoComplete="street-address"
            defaultValue={defaultCity ? `${defaultCity}, NC` : ""}
          />
        </label>
      </div>
      <label className="qf-field">
        <span>Project details</span>
        <textarea name="details" rows={3} placeholder="Approx. size, timeline, anything helpful…" />
      </label>
      <button type="submit" className="cta-primary qf-submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Get My Free Quote"}
      </button>
      {status === "success" && (
        <p className="qf-note qf-note--ok" role="status">
          Thanks! Your request was received. We&apos;ll call you back the same day.
          {!ENDPOINT && " (Demo mode — set NEXT_PUBLIC_FORM_ENDPOINT to receive real submissions.)"}
        </p>
      )}
      {status === "error" && (
        <p className="qf-note qf-note--err" role="status">
          Something went wrong — please call us instead.
        </p>
      )}
    </form>
  );
}
