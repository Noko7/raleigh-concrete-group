"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { services } from "@/lib/site-data";

// Supabase via REST (no SDK). Set these in Vercel → Settings → Environment Variables:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// Run supabase/schema.sql once to create the table + storage bucket.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const UPLOAD_BUCKET = "quote-uploads";
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
  preferredTime: string;
};

const EMPTY: FormState = {
  service: "",
  address: "",
  details: "",
  name: "",
  phone: "",
  email: "",
  preferredTime: "",
};

const ONLINE_STEPS = ["address", "media", "contact"] as const;
const INPERSON_STEPS = ["address", "schedule", "contact"] as const;

const TIME_CHOICES = ["Weekday mornings", "Weekday afternoons", "Evenings", "Weekends", "I'm flexible"];

function cityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 2 ? parts[1] : "";
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
      {loading && <span className="qm-ac-status">Looking up addresses…</span>}
      {!loading && verified && <span className="qm-ac-status qm-ac-ok">✓ Verified address</span>}
      {!loading && !verified && searchedEmpty && (
        <span className="qm-ac-status">No exact match yet — keep typing your full street, city and state.</span>
      )}
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

  const steps = mode === "online" ? ONLINE_STEPS : mode === "inperson" ? INPERSON_STEPS : [];
  const current = mode ? steps[stepIndex] : "choice";
  const totalSteps = 4; // choice + 3
  const stepNumber = mode ? stepIndex + 2 : 1;

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
    const tooBig = incoming.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setFileError(`"${tooBig.name}" is over ${MAX_FILE_MB}MB. Try a shorter video or smaller photo.`);
      return;
    }
    setFileError("");
    setFiles((prev) => [...prev, ...incoming].slice(0, 8));
  }

  function canProceed(): boolean {
    if (current === "address") {
      const hasHouseNumber = /^\s*\d+\s+\S/.test(data.address);
      return (addressVerified || hasHouseNumber) && data.address.trim().length > 8 && data.service !== "";
    }
    if (current === "media") return files.length >= 1;
    if (current === "schedule") return data.preferredTime !== "";
    if (current === "contact") return data.name.trim() !== "" && data.phone.trim() !== "";
    return false;
  }

  function back() {
    if (stepIndex === 0) {
      setMode(null);
    } else {
      setStepIndex((i) => i - 1);
    }
  }

  function next() {
    if (!canProceed()) return;
    if (stepIndex < steps.length - 1) setStepIndex((i) => i + 1);
    else submit();
  }

  // Private bucket: we store the object path (not a public URL). View the files
  // in Supabase → Storage → quote-uploads, or generate a signed URL.
  async function uploadFiles(): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${UPLOAD_BUCKET}/${path}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true",
        },
        body: file,
      });
      if (!res.ok) throw new Error("upload failed");
      paths.push(`${UPLOAD_BUCKET}/${path}`);
    }
    return paths;
  }

  async function submit() {
    if (!SUPABASE_READY) {
      setStatus("success");
      return;
    }
    try {
      let fileUrls: string[] = [];
      if (mode === "online" && files.length) {
        setStatus("uploading");
        fileUrls = await uploadFiles();
      }
      setStatus("sending");
      const payload = {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        service: data.service,
        address: data.address,
        city: cityFromAddress(data.address),
        details: data.details || null,
        quote_type: mode,
        preferred_time: mode === "inperson" ? data.preferredTime : null,
        file_urls: fileUrls.length ? fileUrls : null,
        source_path: typeof window !== "undefined" ? window.location.pathname : "",
      };
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
    } catch {
      setStatus("error");
    }
  }

  const busy = status === "uploading" || status === "sending";

  return (
    <div className="qm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Request a quote">
      <div className="qm-card" onClick={(e) => e.stopPropagation()}>
        <button className="qm-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {status === "success" ? (
          <div className="qm-body qm-success">
            <div className="qm-check">✓</div>
            <h2 className="qm-title">You&apos;re all set!</h2>
            <p className="qm-sub">
              We got your request and we&apos;ll reach out the same day with your quote. Want to talk
              now? Give us a call.
            </p>
            <a href="tel:+19194203146" className="cta-primary qm-full">
              Call (919) 420-3146
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
            {/* Progress */}
            <div className="qm-progress">
              <div className="qm-progress-bar" style={{ width: `${(stepNumber / totalSteps) * 100}%` }} />
            </div>

            {/* Step: choice */}
            {current === "choice" && (
              <div className="qm-body">
                <h2 className="qm-title">Get your free concrete quote</h2>
                <p className="qm-sub">How would you like your quote? Pick the fastest option for you.</p>
                <div className="qm-choices">
                  <button className="qm-choice" onClick={() => pickMode("online")}>
                    <span className="qm-choice-badge">Fastest</span>
                    <span className="qm-choice-icon">⚡</span>
                    <span className="qm-choice-title">Online Quote</span>
                    <span className="qm-choice-desc">
                      Send a few photos and your address. We quote most concrete jobs from satellite
                      plus your pics, often the same day. No waiting on a visit.
                    </span>
                  </button>
                  <button className="qm-choice" onClick={() => pickMode("inperson")}>
                    <span className="qm-choice-icon">📅</span>
                    <span className="qm-choice-title">In-Person Quote</span>
                    <span className="qm-choice-desc">
                      Prefer we come out? Tell us where and when, and we&apos;ll measure on site and
                      give you a written price.
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* Step: address (both paths) */}
            {current === "address" && (
              <div className="qm-body">
                <h2 className="qm-title">Where&apos;s the project?</h2>
                <p className="qm-sub">
                  {mode === "online"
                    ? "We'll pull satellite imagery for this address to get you a fast quote."
                    : "We'll come measure on site."}
                </p>
                <label className="qm-label">Project address</label>
                <AddressAutocomplete
                  value={data.address}
                  verified={addressVerified}
                  onChange={(v) => set({ address: v })}
                  onVerifiedChange={setAddressVerified}
                />
                <label className="qm-label qm-mt">What do you need?</label>
                <select className="qm-input" value={data.service} onChange={(e) => set({ service: e.target.value })}>
                  <option value="" disabled>
                    Choose a service…
                  </option>
                  {services.map((s) => (
                    <option key={s.slug} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                  <option value="Not sure yet">Not sure yet</option>
                </select>
              </div>
            )}

            {/* Step: media (online) */}
            {current === "media" && (
              <div className="qm-body">
                <h2 className="qm-title">Show us the area</h2>
                <p className="qm-sub">
                  A few photos (and a short video if you can) let us quote accurately without a visit.
                  At least one photo is required.
                </p>
                <label className="qm-dropzone">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => addFiles(e.target.files)}
                    hidden
                  />
                  <span className="qm-dropzone-icon">📷</span>
                  <span className="qm-dropzone-title">Tap to add photos or video</span>
                  <span className="qm-dropzone-hint">Up to 8 files, {MAX_FILE_MB}MB each</span>
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
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="qm-label qm-mt">Tell us a bit more about your project</label>
                <textarea
                  className="qm-input"
                  rows={2}
                  value={data.details}
                  onChange={(e) => set({ details: e.target.value })}
                  placeholder="Roughly how much space (e.g. 600 sq ft or 20x30), your timeline, and anything else that helps…"
                />
              </div>
            )}

            {/* Step: schedule (in-person) */}
            {current === "schedule" && (
              <div className="qm-body">
                <h2 className="qm-title">When works for you?</h2>
                <p className="qm-sub">Pick a window and we&apos;ll confirm a time that fits.</p>
                <div className="qm-chips">
                  {TIME_CHOICES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`qm-chip${data.preferredTime === t ? " qm-chip--active" : ""}`}
                      onClick={() => set({ preferredTime: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <label className="qm-label qm-mt">Tell us a bit more about your project</label>
                <textarea
                  className="qm-input"
                  rows={2}
                  value={data.details}
                  onChange={(e) => set({ details: e.target.value })}
                  placeholder="Roughly how much space (e.g. 600 sq ft or 20x30), your timeline, and anything else that helps…"
                />
              </div>
            )}

            {/* Step: contact (both) */}
            {current === "contact" && (
              <div className="qm-body">
                <h2 className="qm-title">Where do we send your quote?</h2>
                <p className="qm-sub">We&apos;ll text or call you the same day. No spam, ever.</p>
                <label className="qm-label">Name</label>
                <input className="qm-input" value={data.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />
                <label className="qm-label qm-mt">Phone</label>
                <input
                  className="qm-input"
                  type="tel"
                  value={data.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                  autoComplete="tel"
                />
                <label className="qm-label qm-mt">Email (optional)</label>
                <input
                  className="qm-input"
                  type="email"
                  value={data.email}
                  onChange={(e) => set({ email: e.target.value })}
                  autoComplete="email"
                />
                {status === "error" && (
                  <p className="qm-err">Something went wrong. Please call us at (919) 420-3146 instead.</p>
                )}
              </div>
            )}

            {/* Footer nav */}
            {current !== "choice" && (
              <div className="qm-footer">
                <button className="qm-back" onClick={back} disabled={busy}>
                  ← Back
                </button>
                <button className="cta-primary qm-next" onClick={next} disabled={!canProceed() || busy}>
                  {status === "uploading"
                    ? "Uploading…"
                    : status === "sending"
                      ? "Sending…"
                      : current === "contact"
                        ? "Get My Free Quote"
                        : "Continue"}
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
