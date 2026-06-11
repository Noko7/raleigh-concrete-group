"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DECLINE_CREDIT } from "@/lib/crm/constants";

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
  const [date, setDate] = useState("");
  const [booked, setBooked] = useState("");
  const [error, setError] = useState("");
  const [dateChecking, setDateChecking] = useState(false);
  const [dateFull, setDateFull] = useState(false);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 11); // ~1.5 weeks out
    return ymd(d);
  }, []);

  async function checkDate(d: string) {
    setDateFull(false);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    setDateChecking(true);
    try {
      const res = await fetch(`/api/availability?type=job&date=${d}`);
      const json = (await res.json()) as { available?: boolean };
      setDateFull(json.available === false);
    } catch {
      setDateFull(false);
    } finally {
      setDateChecking(false);
    }
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
        body: JSON.stringify({ token, action, discount, scheduled_date: action === "accept" ? date : undefined }),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        if (action === "accept") {
          setBooked(date);
          setMode("accepted");
        } else {
          setMode("declined");
        }
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
        <p className="cq-result-eyebrow">Booking confirmed</p>
        <h3>You&apos;re all set for {pretty(booked)}</h3>
        {finalPrice != null && (
          <p className="cq-result-price">
            {discount && <span className="cq-result-save">${DECLINE_CREDIT} credit applied</span>}
            <strong>{usd(finalPrice)}</strong>
          </p>
        )}
        <p className="cq-result-note">
          We&apos;ll reach out to confirm the details and timing. Thanks for choosing Raleigh Concrete Group.
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
          Take ${DECLINE_CREDIT} off &amp; schedule
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
        <h3>Pick your start date</h3>
        <p className="cq-fine">Our earliest opening is about 1.5 weeks out. Pick any date from there.</p>
        {discount && discounted != null && (
          <p className="cq-offer-price">
            With ${DECLINE_CREDIT} credit: <strong>{usd(discounted)}</strong>
          </p>
        )}
        <input
          type="date"
          className="cq-date"
          min={minDate}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            checkDate(e.target.value);
          }}
          disabled={busy}
        />
        {dateChecking && <p className="cq-fine">Checking that day…</p>}
        {!dateChecking && dateFull && <p className="cq-err">That day is already booked. Please pick another.</p>}
        {error && <p className="cq-err">{error}</p>}
        <button
          type="button"
          className="cq-btn cq-btn-accept"
          disabled={!date || busy || dateChecking || dateFull}
          onClick={() => submit("accept")}
        >
          {busy ? "Booking…" : "Confirm booking"}
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
        Accept &amp; schedule
      </button>
      <button type="button" className="cq-btn cq-btn-decline" onClick={() => setMode("save")}>
        Decline
      </button>
    </div>
  );
}
