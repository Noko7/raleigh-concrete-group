"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADDRESS_HINT, isFullAddress } from "@/lib/address";
import { ymdInDays } from "@/lib/crm/clock";
import { DEFAULT_VISIT_SLOTS, VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import { phoneDisplay, phoneHref, quoteServiceOptions } from "@/lib/site-data";

// Supabase via REST (no SDK). Set these in Vercel → Settings → Environment Variables:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// Run supabase/schema.sql once to create the table + storage bucket.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const MAX_FILE_MB = 50;

type Mode = "online" | "inperson";
type Status = "idle" | "uploading" | "sending" | "success" | "error";

type FormState = {
  service: string;
  address: string;
  details: string;
  name: string;
  phone: string;
  email: string;
  visitDate: string;
  visitTime: string;
};

const EMPTY: FormState = {
  service: "",
  address: "",
  details: "",
  name: "",
  phone: "",
  email: "",
  visitDate: "",
  visitTime: "",
};

// Both modes ask for a date, but they mean different things by it, and that
// distinction is the whole point:
//
//   in-person  the customer is booking a visit. We confirm it on the spot.
//   online     a fallback slot in case the job turns out to be too big to price
//              from photos. Nobody is coming out unless a contractor confirms
//              it first, and the customer is told exactly that.
//
// Treating the online date as a booking is what put appointments nobody had
// agreed to on the crew's job page and in the owner's alerts.
const STEPS = ["contact", "service", "schedule"] as const;

type Step = (typeof STEPS)[number];

// The slots shown before a date is picked. Once one is, the real list comes
// back from /api/availability - it belongs to the contractor this job type
// routes to, whose working hours are theirs to set, so it cannot be a constant
// baked into the bundle.
const DEFAULT_SLOTS = DEFAULT_VISIT_SLOTS;

// Soonest an in-person visit can be requested, as YYYY-MM-DD. The server checks
// this too: `min` on a date input is a convenience, not a rule, and picking a
// day in the past used to sail straight through.
function minVisitDate(): string {
  return ymdInDays(VISIT_LEAD_DAYS);
}
function prettyDay(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function cityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 2 ? parts[1] : "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidPhone(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 || (d.length === 11 && d.startsWith("1"));
}
function isValidEmail(email: string): boolean {
  return email === "" || EMAIL_RE.test(email);
}
// Phones (especially iOS) often report an empty or generic MIME type for HEIC
// photos and .mov videos. Infer a real type from the extension so Storage's
// allow-list accepts the upload and the file is stored with the right type.
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
function fileMime(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}
function isAllowedFile(file: File): boolean {
  const m = fileMime(file);
  return m.startsWith("image/") || m.startsWith("video/");
}

/* ── Icons (inline SVG, inherit currentColor) ─────────────────────────────── */
const svgBase = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function IconBolt() {
  return (
    <svg {...svgBase}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg {...svgBase}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}
function IconCamera() {
  return (
    <svg {...svgBase}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg {...svgBase} className={className}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg {...svgBase}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

/* ── Address autocomplete (free US Census geocoder, proxied via /api/address) ─ */
function AddressAutocomplete({
  value,
  verified,
  onChange,
  onVerifiedChange,
}: {
  value: string;
  verified: boolean;
  onChange: (next: string) => void;
  onVerifiedChange: (v: boolean) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showList, setShowList] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);
  // Typed something that already reads as a full address, even if they haven't
  // tapped a suggestion. Both paths are accepted, so both get a green light.
  const complete = isFullAddress(value);

  const lookup = useCallback((q: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    setSearchedEmpty(false);
    if (q.trim().length < 6) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      const myId = ++reqId.current;
      try {
        const res = await fetch(`/api/address?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (myId !== reqId.current) return; // a newer request superseded this one
        const list: string[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setShowList(true);
        setSearchedEmpty(list.length === 0);
      } catch {
        if (myId === reqId.current) setSuggestions([]);
      } finally {
        if (myId === reqId.current) setLoading(false);
      }
    }, 350);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowList(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className="qm-autocomplete" ref={boxRef}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onVerifiedChange(false);
          lookup(e.target.value);
        }}
        onFocus={() => suggestions.length && setShowList(true)}
        placeholder="123 Main St, Raleigh, NC"
        autoComplete="off"
        inputMode="text"
      />
      {/* One status element that always exists, rather than three that appear
          and disappear. Swapping the text inside a fixed slot means the fields
          below never shift while someone is typing, which is what made this
          form jump around on a phone. */}
      <span className={`qm-ac-status qm-slot${verified && !loading ? " qm-ac-ok" : ""}`}>
        {loading ? (
          "Looking up addresses…"
        ) : verified ? (
          <>
            <IconCheck className="qm-ac-check" /> Verified address
          </>
        ) : complete ? (
          "Looks good. Pick a match above if you see yours."
        ) : searchedEmpty ? (
          "No exact match yet. Keep typing your street, city and state."
        ) : (
          ADDRESS_HINT
        )}
      </span>
      {showList && suggestions.length > 0 && (
        <ul className="qm-suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  onChange(s);
                  onVerifiedChange(true);
                  setShowList(false);
                  setSuggestions([]);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── The modal ────────────────────────────────────────────────────────────── */
function Modal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [data, setData] = useState<FormState>(EMPTY);
  const [addressVerified, setAddressVerified] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [fileError, setFileError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [dateChecking, setDateChecking] = useState(false);
  const [dateFull, setDateFull] = useState(false);
  // Slots the crew already has on the chosen day. Greying these out is nicer
  // than letting someone pick one and bounce off a 409 two screens later, but
  // it is not the guard - the server re-checks, because two people can be on
  // this form at once and the browser's copy of "free" goes stale immediately.
  const [takenTimes, setTakenTimes] = useState<string[]>([]);
  // The slots this contractor actually offers on the chosen day, which is a
  // function of their own working hours rather than a fixed list of five.
  const [slots, setSlots] = useState<string[]>(DEFAULT_SLOTS);
  // They don't work that weekday at all. Distinct from "every hour is taken",
  // because the answer is a different day rather than a different time.
  const [dayOff, setDayOff] = useState(false);
  const minDate = useRef(minVisitDate()).current;

  // `service` decides whose calendar this is: a lead goes to the contractor who
  // takes that job type. Checking against the primary contractor regardless,
  // which is what this used to do, answered about the wrong person's day for
  // every lead the routing rules send elsewhere.
  async function checkVisitDate(date: string, service: string) {
    setDateFull(false);
    setDayOff(false);
    setTakenTimes([]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setDateChecking(true);
    try {
      const res = await fetch(
        `/api/availability?type=quote&date=${date}&service=${encodeURIComponent(service)}`,
      );
      const json = (await res.json()) as {
        available?: boolean;
        slots?: string[];
        taken?: string[];
        works?: boolean;
      };
      setDateFull(json.available === false);
      setDayOff(json.works === false);
      const open = Array.isArray(json.slots) && json.slots.length > 0 ? json.slots : DEFAULT_SLOTS;
      const taken = Array.isArray(json.taken) ? json.taken : [];
      setSlots(open);
      setTakenTimes(taken);
      // If they had already chosen a time and it's gone - taken, or no longer
      // a slot this contractor offers - drop it rather than leaving a selected
      // chip that will be rejected on submit.
      setData((d) =>
        d.visitTime && (taken.includes(d.visitTime) || !open.includes(d.visitTime))
          ? { ...d, visitTime: "" }
          : d,
      );
    } catch {
      // Don't block on a network hiccup; the server re-checks either way.
      setDateFull(false);
      setDayOff(false);
    } finally {
      setDateChecking(false);
    }
  }

  const current: Step | "choice" = mode ? STEPS[stepIndex] : "choice";
  const totalSteps = STEPS.length;
  const stepNumber = stepIndex + 1;
  const isLastStep = stepIndex === STEPS.length - 1;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = (patch: Partial<FormState>) => setData((d) => ({ ...d, ...patch }));

  function pickMode(next: Mode) {
    setMode(next);
    setStepIndex(0);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const badType = incoming.find((f) => !isAllowedFile(f));
    if (badType) {
      setFileError(`"${badType.name}" isn't a photo or video. Please add images or video only.`);
      return;
    }
    const tooBig = incoming.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setFileError(`"${tooBig.name}" is over ${MAX_FILE_MB}MB. Try a shorter video or smaller photo.`);
      return;
    }
    setFileError("");
    setFiles((prev) => [...prev, ...incoming].slice(0, 8));
  }

  function canProceed(): boolean {
    if (current === "contact") {
      // A quote needs an address we can actually find: either one picked from
      // the search, or one typed out in full with city and state. A bare house
      // number and street used to be enough, which cost a phone call to chase.
      return (
        data.name.trim().length >= 2 &&
        isValidPhone(data.phone) &&
        isValidEmail(data.email) &&
        (addressVerified || isFullAddress(data.address))
      );
    }
    if (current === "service") return data.service !== "";
    if (current === "schedule") {
      const picked = /^\d{4}-\d{2}-\d{2}$/.test(data.visitDate) && data.visitTime !== "";
      // A full or non-working day only blocks an in-person request, which is
      // the only one taking a slot out of somebody's day. An online customer is
      // offering a fallback we may never use, so "that day is busy" is not a
      // reason to stop them submitting their photos.
      if (mode === "online") return picked && !dateChecking;
      return picked && !dateFull && !dayOff && !dateChecking;
    }
    return false;
  }

  // Moving between steps clears any stale complaint from the last submit, so a
  // fixed field doesn't keep showing the old reason it was rejected.
  function back() {
    setErrorMsg("");
    if (stepIndex === 0) setMode(null);
    else setStepIndex((i) => i - 1);
  }

  function next() {
    if (!canProceed()) return;
    setErrorMsg("");
    if (!isLastStep) setStepIndex((i) => i + 1);
    else submit();
  }

  // Private bucket. The browser no longer has blanket write access: we ask our
  // server for a one-time signed upload URL (rate-limited + type-checked) and
  // PUT the file straight to it. We store only the object path on the lead row.
  async function uploadFiles(): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      const contentType = fileMime(file);
      const ext = file.name.includes(".")
        ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
        : "bin";

      const signRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ext: ext || "bin", contentType }),
      });
      if (!signRes.ok) throw new Error(`could not authorize upload (${signRes.status})`);
      const signed = (await signRes.json()) as { ok?: boolean; path?: string; uploadUrl?: string };
      if (!signed.ok || !signed.uploadUrl || !signed.path) throw new Error("could not authorize upload");

      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, "x-upsert": "true" },
        body: file,
      });
      if (!put.ok) {
        const detail = await put.text().catch(() => "");
        throw new Error(detail || `upload failed (${put.status})`);
      }
      paths.push(signed.path);
    }
    return paths;
  }

  async function submit() {
    // Bot trap: a real user can't fill the hidden honeypot. Silently "succeed".
    if (honeypot.trim() !== "") {
      setStatus("success");
      return;
    }
    setErrorMsg("");
    try {
      let fileUrls: string[] = [];
      if (files.length && SUPABASE_READY) {
        setStatus("uploading");
        try {
          fileUrls = await uploadFiles();
        } catch {
          setErrorMsg(
            `We couldn't upload one of your photos. Try fewer or smaller files, or call us at ${phoneDisplay}.`,
          );
          setStatus("error");
          return;
        }
      }
      setStatus("sending");
      const payload = {
        name: data.name,
        phone: data.phone,
        email: data.email,
        service: data.service,
        address: data.address,
        city: cityFromAddress(data.address),
        details: data.details,
        quote_type: mode ?? "inperson",
        preferred_time: data.visitTime,
        visit_date: data.visitDate,
        visit_time: data.visitTime,
        file_urls: fileUrls,
        source_path: typeof window !== "undefined" ? window.location.pathname : "",
        company: honeypot, // honeypot, validated server-side
      };
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string; fields?: string[] };
      if (res.ok && json.ok) {
        setStatus("success");
      } else if (json.fields?.includes("address") || json.fields?.includes("phone") || json.fields?.includes("name")) {
        // Rejected on the contact details: take them back to that step rather
        // than showing the reason on a screen that can't fix it.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("contact"));
        setAddressVerified(false);
        setErrorMsg(json.error || "Please check your contact details.");
      } else if (
        res.status === 409 ||
        json.fields?.includes("visit_date") ||
        json.fields?.includes("visit_time")
      ) {
        // The day filled up, the slot went, or the date is too soon - all of
        // them mean "go back and pick again". Re-check the day on the way so
        // the chips redraw against what's actually left rather than the
        // snapshot they chose from.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("schedule"));
        setErrorMsg(json.error || "");
        void checkVisitDate(data.visitDate);
      } else {
        setErrorMsg(json.error || `Something went wrong saving your request. Please call us at ${phoneDisplay}.`);
        setStatus("error");
      }
    } catch {
      setErrorMsg(`Something went wrong. Please call us at ${phoneDisplay}.`);
      setStatus("error");
    }
  }

  const busy = status === "uploading" || status === "sending";

  return (
    <div className="qm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Request a quote">
      <div className="qm-card" onClick={(e) => e.stopPropagation()}>
        <button className="qm-close" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>

        {status === "success" ? (
          <div className="qm-body qm-success">
            <div className="qm-check">
              <IconCheck />
            </div>
            <h2 className="qm-title">You&apos;re all set!</h2>
            <p className="qm-sub">
              We got your request and we&apos;ll reach out the same day with your quote. Want to talk
              now? Give us a call.
            </p>
            <a href={phoneHref} className="cta-primary qm-full">
              Call {phoneDisplay}
            </a>
            <button className="qm-text-btn" onClick={onClose}>
              Close
            </button>
            {!SUPABASE_READY && (
              <p className="qm-demo">Demo mode. Add your Supabase keys in Vercel to start saving real requests.</p>
            )}
          </div>
        ) : (
          <>
            {/* Progress (hidden on the choice screen) */}
            {mode && (
              <div className="qm-progress">
                <div className="qm-progress-bar" style={{ width: `${(stepNumber / totalSteps) * 100}%` }} />
              </div>
            )}

            {/* Step: choice (online vs in-person) */}
            {current === "choice" && (
              <div className="qm-body">
                <h2 className="qm-title">Get your free concrete quote</h2>
                <p className="qm-sub">How would you like your quote? Pick the fastest option for you.</p>
                <div className="qm-choices">
                  <button className="qm-choice" onClick={() => pickMode("online")}>
                    <span className="qm-choice-badge">Fastest</span>
                    <span className="qm-choice-icon">
                      <IconBolt />
                    </span>
                    <span className="qm-choice-title">Online Quote</span>
                    <span className="qm-choice-desc">
                      Send a few photos and your address. We quote most concrete jobs from satellite
                      plus your pics, often the same day.
                    </span>
                  </button>
                  <button className="qm-choice" onClick={() => pickMode("inperson")}>
                    <span className="qm-choice-icon">
                      <IconCalendar />
                    </span>
                    <span className="qm-choice-title">In-Person Quote</span>
                    <span className="qm-choice-desc">
                      Prefer we come out? Tell us where and when, and we&apos;ll measure on site and
                      give you a written price.
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 1: Contact (name, phone, address together) */}
            {current === "contact" && (
              <div className="qm-body">
                <div className="qm-step-head">
                  <span className="qm-step-num">1</span>
                  <h2 className="qm-title">Contact</h2>
                </div>
                <p className="qm-sub">Share your contact and address details and we&apos;ll prepare your free, no-obligation quote.</p>
                <label className="qm-label">Name</label>
                <input
                  className="qm-input"
                  value={data.name}
                  onChange={(e) => set({ name: e.target.value })}
                  autoComplete="name"
                  maxLength={120}
                  placeholder="First and last name"
                />
                <label className="qm-label qm-mt">Phone</label>
                <input
                  className="qm-input"
                  type="tel"
                  value={data.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                  autoComplete="tel"
                  maxLength={32}
                  inputMode="tel"
                  placeholder="(919) 555-0123"
                />
                {/* Fixed-height slot: the message swaps in and out without
                    moving the address field below it. */}
                <span className="qm-ac-status qm-slot">
                  {data.phone.trim() !== "" && !isValidPhone(data.phone) ? "Enter a 10-digit US phone number." : ""}
                </span>
                <label className="qm-label">Property address</label>
                <AddressAutocomplete
                  value={data.address}
                  verified={addressVerified}
                  onChange={(v) => set({ address: v })}
                  onVerifiedChange={setAddressVerified}
                />
                <label className="qm-label">Email (optional)</label>
                <input
                  className="qm-input"
                  type="email"
                  value={data.email}
                  onChange={(e) => set({ email: e.target.value })}
                  autoComplete="email"
                  maxLength={200}
                  placeholder="you@email.com"
                />
                <span className="qm-ac-status qm-slot">
                  {!isValidEmail(data.email) ? "Enter a valid email address." : ""}
                </span>

                {/* A server-side rejection of the contact details lands here,
                    on the step that can actually fix it. */}
                {errorMsg && <p className="qm-err">{errorMsg}</p>}

                {/* Honeypot: hidden from real users; bots fill it and get dropped. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", height: 0, width: 0, overflow: "hidden" }}>
                  <label>
                    Company
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={(e) => setHoneypot(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Step 2: Service */}
            {current === "service" && (
              <div className="qm-body">
                <div className="qm-step-head">
                  <span className="qm-step-num">2</span>
                  <h2 className="qm-title">Service</h2>
                </div>
                <p className="qm-sub">Select the service you want performed.</p>
                <label className="qm-label">What do you need?</label>
                <select className="qm-input" value={data.service} onChange={(e) => set({ service: e.target.value })}>
                  <option value="" disabled>
                    Choose a service…
                  </option>
                  {quoteServiceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                <label className="qm-label qm-mt">Tell us a bit more (optional)</label>
                <textarea
                  className="qm-input"
                  rows={2}
                  value={data.details}
                  onChange={(e) => set({ details: e.target.value })}
                  placeholder="Roughly how much space (e.g. 600 sq ft or 20x30), your timeline, and anything else that helps…"
                />

                <label className="qm-dropzone qm-mt">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => addFiles(e.target.files)}
                    hidden
                  />
                  <span className="qm-dropzone-icon">
                    <IconCamera />
                  </span>
                  <span className="qm-dropzone-title">Add photos or video (optional)</span>
                  <span className="qm-dropzone-hint">Speeds up your quote. Up to 8 files, {MAX_FILE_MB}MB each</span>
                </label>
                {fileError && <p className="qm-err">{fileError}</p>}
                {files.length > 0 && (
                  <ul className="qm-filelist">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`}>
                        <span className="qm-file-name">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label={`Remove ${f.name}`}
                        >
                          <IconClose />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Step 3: Schedule. In-person books a visit; online picks a
                fallback slot we only use if the job can't be priced remotely. */}
            {current === "schedule" && (
              <div className="qm-body">
                <div className="qm-step-head">
                  <span className="qm-step-num">3</span>
                  <h2 className="qm-title">{mode === "online" ? "If we need to visit" : "Schedule"}</h2>
                </div>
                {/* The online wording promises nothing. Most jobs never need a
                    visit, and a customer who thinks they have an appointment
                    when they don't is the worst outcome here. */}
                <p className="qm-sub">
                  {mode === "online"
                    ? "We can price most jobs from your photos. If yours needs a look in person, when suits you? We'll only come out if we text you first to confirm."
                    : "Select from the available dates and times."}
                </p>
                <label className="qm-label">{mode === "online" ? "Best day for you" : "Date"}</label>
                <input
                  className="qm-input"
                  type="date"
                  min={minDate}
                  value={data.visitDate}
                  onChange={(e) => {
                    set({ visitDate: e.target.value });
                    // Both modes ask, for different reasons. In-person is
                    // taking a slot out of somebody's day and has to know it's
                    // free. Online is only offering a fallback, but the hours
                    // still have to be hours that crew works - a slot offered
                    // at 6pm to somebody who finishes at 4 is a fallback that
                    // can never be taken up.
                    checkVisitDate(e.target.value, data.service);
                  }}
                />
                <span
                  className={`qm-ac-status qm-slot${
                    dateChecking ? "" : dateFull ? " qm-ac-full" : data.visitDate ? " qm-ac-ok" : ""
                  }`}
                >
                  {mode === "online" ? (
                    data.visitDate ? (
                      <>
                        <IconCheck className="qm-ac-check" /> We&apos;ll aim for {prettyDay(data.visitDate)} if a visit
                        is needed
                      </>
                    ) : (
                      "Just in case - we'll confirm by text before anyone comes out."
                    )
                  ) : dateChecking ? (
                    "Checking that day…"
                  ) : dayOff ? (
                    "We don't take visits that day, please pick another."
                  ) : dateFull ? (
                    "That day is fully booked, please pick another."
                  ) : data.visitDate ? (
                    <>
                      <IconCheck className="qm-ac-check" /> {prettyDay(data.visitDate)} is open
                    </>
                  ) : (
                    `Earliest we can come out is ${VISIT_LEAD_DAYS} days from today.`
                  )}
                </span>
                <label className="qm-label">Time</label>
                <div className="qm-chips">
                  {slots.map((t) => {
                    const taken = takenTimes.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={taken}
                        title={taken ? "Already booked" : undefined}
                        className={`qm-chip${data.visitTime === t ? " qm-chip--active" : ""}${
                          taken ? " qm-chip--taken" : ""
                        }`}
                        onClick={() => set({ visitTime: t })}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {takenTimes.length > 0 && !dateFull && (
                  <span className="qm-ac-status qm-slot">Greyed-out times are already booked that day.</span>
                )}

                {/* Shown whenever there's a message, not only in the "error"
                    status: a rejected date bounces back here as idle, and the
                    reason has to come with it. */}
                {(status === "error" || errorMsg) && (
                  <p className="qm-err">{errorMsg || `Something went wrong. Please call us at ${phoneDisplay} instead.`}</p>
                )}
              </div>
            )}

            {/* SMS consent disclosure (A2P 10DLC compliant), shown before submitting */}
            {mode && isLastStep && (
              <p className="qm-consent">
                By submitting this form, you agree to receive text messages from Raleigh Concrete
                Group about your quote request, appointment reminders, and project updates. Message
                frequency varies. Message &amp; data rates may apply. Reply HELP for help or STOP to
                unsubscribe at any time. See our{" "}
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="qm-consent-link">
                  Privacy Policy
                </a>
                .
              </p>
            )}

            {/* Footer nav (hidden on the choice screen) */}
            {mode && (
            <div className="qm-footer">
              <button className="qm-back" onClick={back} disabled={busy}>
                Back
              </button>
              <button className="cta-primary qm-next" onClick={next} disabled={!canProceed() || busy}>
                {status === "uploading"
                  ? "Uploading…"
                  : status === "sending"
                    ? "Sending…"
                    : !isLastStep
                      ? "Continue"
                      : mode === "inperson"
                        ? "Book My Free Quote"
                        : "Get My Free Quote"}
              </button>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Root: intercept #quote CTAs site-wide and render the modal ───────────── */
export function QuoteModalRoot() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const trigger = target?.closest?.('a[href="#quote"], a[href$="#quote"], [data-open-quote]');
      if (trigger) {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!open) return null;
  return <Modal onClose={() => setOpen(false)} />;
}
