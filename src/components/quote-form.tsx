"use client";

import { useState } from "react";
import { services } from "@/lib/site-data";

type Status = "idle" | "sending" | "success" | "error";

// Submissions go through our validated server endpoint (/api/quote), which
// writes to the database with a server-only key. The browser never touches the
// database directly. Runs in demo mode automatically if the server has no keys.
export function QuoteForm({
  defaultCity,
  defaultService,
}: {
  defaultCity?: string;
  defaultService?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [demo, setDemo] = useState(false);

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
      company: String(data.get("company") ?? ""), // honeypot
    };

    setStatus("sending");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; demo?: boolean };
      if (res.ok && json.ok) {
        setStatus("success");
        setDemo(Boolean(json.demo));
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="quote-form">
      <div className="qf-row">
        <label className="qf-field">
          <span>Name</span>
          <input name="name" autoComplete="name" required minLength={2} maxLength={120} />
        </label>
        <label className="qf-field">
          <span>Phone</span>
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            maxLength={32}
            pattern="[0-9()+\-.\s]{10,}"
            title="Enter a 10-digit US phone number"
          />
        </label>
      </div>
      <div className="qf-row">
        <label className="qf-field">
          <span>Service</span>
          <select name="service" defaultValue={defaultService ?? ""} required>
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
            required
            maxLength={300}
            defaultValue={defaultCity ? `${defaultCity}, NC` : ""}
            placeholder="123 Main St, Raleigh, NC"
          />
        </label>
      </div>
      <label className="qf-field">
        <span>Project details</span>
        <textarea
          name="details"
          rows={3}
          maxLength={2000}
          placeholder="Roughly how much space (e.g. 600 sq ft), your timeline, anything else that helps…"
        />
      </label>

      {/* Honeypot: hidden from real users; bots fill it and get dropped server-side. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, width: 0, overflow: "hidden" }}>
        <label>
          Company
          <input name="company" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button type="submit" className="cta-primary qf-submit" disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : "Get My Free Quote"}
      </button>
      {status === "success" && (
        <p className="qf-note qf-note--ok" role="status">
          Thanks! We got your request and we&apos;ll give you a call back the same day.
          {demo && " (Demo mode. Add your Supabase keys to start saving real requests.)"}
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
