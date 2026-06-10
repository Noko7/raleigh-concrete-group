"use client";

import { useState } from "react";
import { services } from "@/lib/site-data";

type Status = "idle" | "sending" | "success" | "error";

// Quote requests are saved straight into Supabase via its REST (PostgREST) API,
// so there's no extra SDK to install. Set these two in Vercel → Project →
// Settings → Environment Variables (and in a local .env.local for dev):
//   NEXT_PUBLIC_SUPABASE_URL       e.g. https://abcd1234.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  the project's anon/public key
// Then run the SQL in website/supabase/schema.sql once to create the table.
// Without these set, the form runs in friendly demo mode.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function QuoteForm({ defaultCity }: { defaultCity?: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);

    const payload = {
      name: String(data.get("name") ?? ""),
      phone: String(data.get("phone") ?? ""),
      service: String(data.get("service") ?? ""),
      address: String(data.get("address") ?? ""),
      city: defaultCity ?? "",
      details: String(data.get("details") ?? ""),
      source_path: typeof window !== "undefined" ? window.location.pathname : "",
    };

    if (!SUPABASE_READY) {
      setStatus("success");
      form.reset();
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/quote_requests`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(payload),
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
              What do you need?
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
        <textarea name="details" rows={3} placeholder="Rough size, your timeline, anything else that helps…" />
      </label>
      <button type="submit" className="cta-primary qf-submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Get My Free Quote"}
      </button>
      {status === "success" && (
        <p className="qf-note qf-note--ok" role="status">
          Thanks! We got your request and we&apos;ll give you a call back the same day.
          {!SUPABASE_READY && " (Demo mode — add your Supabase keys to start saving real requests.)"}
        </p>
      )}
      {status === "error" && (
        <p className="qf-note qf-note--err" role="status">
          Hmm, that didn&apos;t go through. Mind giving us a call instead?
        </p>
      )}
    </form>
  );
}
