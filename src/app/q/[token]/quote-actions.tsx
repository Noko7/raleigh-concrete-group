"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DECLINE_CREDIT, LEAD_TIME_DAYS, MAX_PREFERRED_DATES } from "@/lib/crm/constants";

type Mode = "choose" | "save" | "schedule" | "submitting" | "accepted" | "declined";

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function pretty(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function QuoteActions({ token, amount }: { token: string; amount: number | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [discount, setDiscount] = useState(false);
  // Days the customer says work for them. The crew confirms one of these against
  // their own schedule, so nothing here is a booking.
  const [picks, setPicks] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState<string[]>([]);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + LEAD_TIME_DAYS);
    return ymd(d);
  }, []);

  // Warn early if a day is already spoken for, so the customer doesn't offer
  // three days we can't use.
  async function addDate(d: string) {
    setError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (picks.includes(d)) {
      setDraft("");
      return;
    }
    if (picks.length >= MAX_PREFERRED_DATES) {
      setError(`You can suggest up to ${MAX_PREFERRED_DATES} days.`);
      return;
    }
    setPicks((p) => [...p, d].sort());
    setDraft("");

    setChecking(true);
    try {
      const res = await fetch(`/api/availability?type=job&date=${d}`);
      const json = (await res.json()) as { available?: boolean };
      if (json.available === false) setTaken((t) => (t.includes(d) ? t : [...t, d]));
    } catch {
      // A failed check is not worth blocking on - the crew confirms anyway.
    } finally {
      setChecking(false);
    }
  }

  function removeDate(d: string) {
    setPicks((p) => p.filter((x) => x !== d));
    setTaken((t) => t.filter((x) => x !== d));
  }

  const discounted = amount != null ? Math.max(0, Math.round((amount - DECLINE_CREDIT) * 100) / 100) : null;

  async function submit(action: "accept" | "decline") {
    setError("");
    const fallback: Mode = action === "accept" ? "schedule" : "save";
    setMode("submitting");
    try {
      const res = await fetch("/api/quote-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action,
          discount,
          preferred_dates: action === "accept" ? picks : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        setMode(action === "accept" ? "accepted" : "declined");
        // Re-render the server page into its full-screen confirmed/declined view.
        router.refresh();
      } else {
        setError(json.error || "Something went wrong. Please call us.");
        setMode(fallback);
      }
    } catch {
      setError("Something went wrong. Please call us.");
      setMode(fallback);
    }
  }

  if (mode === "accepted") {
    const finalPrice = discount && discounted != null ? discounted : amount;
    return (
      <div className="cq-result cq-result-ok">
        <p className="cq-result-eyebrow">Quote approved</p>
        <h3>Thanks — we&apos;ll confirm your date shortly</h3>
        {finalPrice != null && (
          <p className="cq-result-price">
            {discount && <span className="cq-result-save">${DECLINE_CREDIT} credit applied</span>}
            <strong>{usd(finalPrice)}</strong>
          </p>
        )}
        {picks.length > 0 && (
          <p className="cq-result-note">
            You told us these work: {picks.map((d) => pretty(d)).join(", ")}.
          </p>
        )}
        <p className="cq-result-note">
          We&apos;re checking the crew&apos;s schedule now and will text you to confirm your installation date.
        </p>
      </div>
    );
  }

  if (mode === "declined") {
    return (
      <div className="cq-result">
        <p className="cq-result-eyebrow">Quote declined</p>
        <h3>Thanks for letting us know</h3>
        <p className="cq-result-note">No hard feelings. If anything changes, we&apos;re just a call or text away.</p>
      </div>
    );
  }

  if (mode === "save") {
    return (
      <div className="cq-offer">
        <p className="cq-offer-eyebrow">Wait, before you go</p>
        <h3>Here&apos;s a ${DECLINE_CREDIT} credit to earn your business.</h3>
        {discounted != null && (
          <p className="cq-offer-price">
            <s>{usd(amount as number)}</s> <strong>{usd(discounted)}</strong>
          </p>
        )}
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          onClick={() => {
            setDiscount(true);
            setMode("schedule");
          }}
        >
          Take ${DECLINE_CREDIT} off &amp; approve
        </button>
        <button type="button" className="cq-textlink" onClick={() => submit("decline")}>
          No thanks, decline
        </button>
      </div>
    );
  }

  if (mode === "schedule" || mode === "submitting") {
    const busy = mode === "submitting";
    return (
      <div className="cq-schedule">
        <h3>Which days work for you?</h3>
        <p className="cq-fine">
          Pick up to {MAX_PREFERRED_DATES} days that suit you, starting about {LEAD_TIME_DAYS} days out. Our crew will
          confirm one of them and text you back — nothing is booked until then.
        </p>
        {discount && discounted != null && (
          <p className="cq-offer-price">
            With ${DECLINE_CREDIT} credit: <strong>{usd(discounted)}</strong>
          </p>
        )}

        {picks.length > 0 && (
          <ul className="cq-picks">
            {picks.map((d) => (
              <li key={d} className={taken.includes(d) ? "cq-pick cq-pick-taken" : "cq-pick"}>
                <span>
                  {pretty(d)}
                  {taken.includes(d) && <em> — likely full, we&apos;ll suggest another</em>}
                </span>
                <button type="button" onClick={() => removeDate(d)} disabled={busy} aria-label={`Remove ${pretty(d)}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {picks.length < MAX_PREFERRED_DATES && (
          <input
            type="date"
            className="cq-date"
            min={minDate}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              addDate(e.target.value);
            }}
            disabled={busy}
          />
        )}
        {checking && <p className="cq-fine">Checking that day…</p>}
        {error && <p className="cq-err">{error}</p>}

        <button
          type="button"
          className="cq-btn cq-btn-accept"
          disabled={picks.length === 0 || busy}
          onClick={() => submit("accept")}
        >
          {busy ? "Sending…" : "Approve quote"}
        </button>
        <button type="button" className="cq-textlink" disabled={busy} onClick={() => setMode("choose")}>
          Back
        </button>
      </div>
    );
  }

  // choose
  return (
    <div className="cq-actions">
      <button
        type="button"
        className="cq-btn cq-btn-accept"
        onClick={() => {
          setDiscount(false);
          setMode("schedule");
        }}
      >
        Approve quote
      </button>
      <button type="button" className="cq-btn cq-btn-decline" onClick={() => setMode("save")}>
        Decline
      </button>
    </div>
  );
}
