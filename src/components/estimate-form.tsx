"use client";

import { useEffect, useRef, useState } from "react";

import { newAttemptId, trackFunnel } from "@/lib/funnel-client";
import { phoneDisplay, quoteServiceOptions } from "@/lib/site-data";

type Status = "idle" | "sending" | "success" | "error";

export function EstimateForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [service, setService] = useState("");
  const [details, setDetails] = useState("");
  const [consent, setConsent] = useState(false);
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneOk = phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1"));
  const addressOk = address.trim().length >= 5 && /\d/.test(address);
  const canSubmit = name.trim().length >= 2 && phoneOk && addressOk && consent;

  // Same funnel as the quote pop-up (src/lib/funnel.ts), counted separately on
  // the Funnel page. One screen, so the only questions are "did they send it"
  // and, if not, what was still missing when they left.
  const attemptId = useRef("");
  const openedAt = useRef(0);
  const sent = useRef(false);
  const missing = useRef("");
  missing.current =
    [name.trim().length < 2 && "name", !phoneOk && "phone", !addressOk && "address", !consent && "consent"]
      .filter(Boolean)
      .join("+") || "ready";
  const track = (event: "open" | "close" | "error" | "submit", extra: { ms?: number; detail?: string } = {}) =>
    trackFunnel({ attempt_id: attemptId.current, form: "estimate", step: "estimate", event, ...extra });

  useEffect(() => {
    attemptId.current = newAttemptId();
    openedAt.current = Date.now();
    track("open");
    const onHide = () => {
      if (sent.current) return;
      sent.current = true;
      track("close", { ms: Date.now() - openedAt.current, detail: missing.current });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
    // Once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (company.trim() !== "") {
      sent.current = true;
      setStatus("success"); // bot trap
      return;
    }
    if (!canSubmit || status === "sending") return;
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          email,
          service,
          address,
          details,
          source_path: "/estimate",
          company,
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        sent.current = true;
        track("submit", { ms: Date.now() - openedAt.current });
        setStatus("success");
      } else {
        track("error", { detail: `server_${res.status}` });
        setErrorMsg(json.error || `Something went wrong. Please call us at ${phoneDisplay}.`);
        setStatus("error");
      }
    } catch {
      track("error", { detail: "network" });
      setErrorMsg(`Something went wrong. Please call us at ${phoneDisplay}.`);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center">
        <h2 className="mb-3 font-headline text-3xl text-[#2b1a12]">Thanks, we got it.</h2>
        <p className="text-[#2b1a12]/80">
          We&apos;ll review your project and text or call you shortly, usually the same day. If you need
          us right away, call {phoneDisplay}.
        </p>
      </div>
    );
  }

  return (
    <form className="quote-form" onSubmit={onSubmit} noValidate data-clarity-mask="true">
      <div className="qf-row">
        <label className="qf-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </label>
        <label className="qf-field">
          <span>Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="(919) 555-1234"
            required
          />
        </label>
      </div>

      <div className="qf-row">
        <label className="qf-field">
          <span>Email (optional)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>
        <label className="qf-field">
          <span>Service</span>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Select a service</option>
            {quoteServiceOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="qf-field">
        <span>Project address</span>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="street-address"
          placeholder="123 Main St, Raleigh, NC"
          required
        />
      </label>

      <label className="qf-field">
        <span>Project details (optional)</span>
        <textarea
          rows={3}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Tell us a little about what you need."
        />
      </label>

      {/* Honeypot: hidden from real users */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
        <label>
          Company
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>

      <label className="estimate-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          required
        />
        <span>
          I agree to receive recurring automated text messages from{" "}
          <strong>Raleigh Concrete Group</strong> regarding my quote, appointments, and project
          updates. Message &amp; data rates may apply. Message frequency varies. Reply{" "}
          <strong>HELP</strong> for help and <strong>STOP</strong> to unsubscribe. View our{" "}
          <a href="/privacy-policy">Privacy Policy</a> and <a href="/terms">SMS Terms</a>.
        </span>
      </label>

      {status === "error" && <p className="qf-note qf-note--err">{errorMsg}</p>}

      <button type="submit" className="cta-primary qf-submit" disabled={!canSubmit || status === "sending"}>
        {status === "sending" ? "Sending…" : "Request My Free Estimate"}
      </button>
    </form>
  );
}
