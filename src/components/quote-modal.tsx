"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ADDRESS_HINT, isFullAddress } from "@/lib/address";
import { ymdInDays } from "@/lib/crm/clock";
import { DEFAULT_VISIT_SLOTS, VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import { newAttemptId, trackFunnel, type TrackInput } from "@/lib/funnel-client";
import {
  isConfirmedSave,
  isValidUsPhone,
  leadReference,
  newSubmissionId,
  smsFallbackHref,
  UUID_RE,
} from "@/lib/quote-submit";
import { phoneDisplay, phoneHref, quoteServiceOptions } from "@/lib/site-data";

// Everything this form saves goes through our own server (/api/upload-url and
// /api/quote), which holds the database keys. The browser used to check its
// own copy of the Supabase settings and, if they were missing, skip the photo
// upload without a word and still say "You're all set!" - so it no longer
// looks at them at all. If the server can't save, the server says so.
const MAX_FILE_MB = 50;

// How long to wait for /api/quote before telling the customer we couldn't
// confirm it. Generous, because the request itself is small and the server
// answers before sending any texts; anything past this is a hang, not a slow
// network. A retry after a timeout is safe: see submissionId below.
const SUBMIT_TIMEOUT_MS = 30_000;
const SIGN_TIMEOUT_MS = 15_000;
// A photo upload is given up on when no bytes have moved for this long - not
// after a fixed total, because a 40MB video on a weak signal is slow but fine,
// and one that has stopped moving is not going to finish.
const UPLOAD_STALL_MS = 45_000;

// What they've typed, kept for this tab so closing the form by accident (a tap
// outside it, Escape, the back gesture) and opening it again doesn't mean
// typing it all again. Also carries the submission id, so the reopened form is
// the same request and not a second one. Cleared once it's sent. Photos can't
// be kept this way; the rest can.
const DRAFT_KEY = "rcg_quote_form_v1";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type Saved = {
  v: 1;
  at: number;
  submissionId: string;
  mode: Mode | null;
  stepIndex: number;
  data: FormState;
  addressVerified: boolean;
};
function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (s?.v !== 1 || Date.now() - s.at > DRAFT_MAX_AGE_MS || !UUID_RE.test(s.submissionId)) return null;
    return {
      ...s,
      mode: s.mode === "online" || s.mode === "inperson" ? s.mode : null,
      stepIndex: Number.isInteger(s.stepIndex) && s.stepIndex >= 0 && s.stepIndex < 3 ? s.stepIndex : 0,
      data: { ...EMPTY, ...s.data },
    };
  } catch {
    return null;
  }
}
function storeSaved(s: Omit<Saved, "v" | "at">) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, at: Date.now(), ...s }));
  } catch {
    // Private mode or storage full: the form still works, it just won't remember.
  }
}
function clearSaved() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}

// PUT a file to its signed URL with progress, giving up only when it stalls.
function putFile(url: string, file: File, contentType: string, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => xhr.abort(), UPLOAD_STALL_MS);
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => {
      arm();
      if (e.lengthComputable && e.total) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed (${xhr.status})`));
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      reject(new Error("upload network error"));
    };
    xhr.onabort = () => {
      clearTimeout(timer);
      reject(new Error("upload stalled"));
    };
    arm();
    xhr.send(file);
  });
}

// fetch with a deadline. An AbortError comes back as a thrown error, which the
// caller treats like any other failure to confirm.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

// "2026-09-28" -> "Mon, Sep 28", for the one-tap day chips.
function shortDay(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(`${s}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function cityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 2 ? parts[1] : "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidPhone = isValidUsPhone;
// Enough of an address to go on. A full "123 Main St, Raleigh, NC" is still
// what the field asks for and what it shows a green light for, but it no longer
// stops anyone: a lead with a partial address is a phone call, a lead that gave
// up on the address field is nothing. The server notes it on the lead.
function hasSomeAddress(a: string): boolean {
  return a.trim().length >= 5;
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
      <input data-clarity-mask="true"
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
        <ul className="qm-suggestions" data-clarity-mask="true">
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
  // Picked up where they left off, if they closed it earlier in this tab.
  const restored = useRef(loadSaved()).current;
  const [mode, setMode] = useState<Mode | null>(restored?.mode ?? null);
  const [stepIndex, setStepIndex] = useState(restored?.mode ? restored.stepIndex : 0);
  const [data, setData] = useState<FormState>(restored?.data ?? EMPTY);
  const [addressVerified, setAddressVerified] = useState(restored?.addressVerified ?? false);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [fileError, setFileError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [honeypot, setHoneypot] = useState("");
  // The reference of the saved lead, shown on the success screen. The success
  // screen cannot render without one: it only exists once the server has
  // handed back the id of the row it wrote.
  const [leadRef, setLeadRef] = useState("");
  // Photos that didn't make it, for the success screen to ask for by text.
  const [filesFailed, setFilesFailed] = useState(0);
  const [uploadNote, setUploadNote] = useState("");
  // One per filled-in form, sent on every attempt (lib/quote-submit.ts). The
  // server keeps it under a unique index, so pressing the button again after a
  // timeout finds the lead already saved instead of making a second one.
  const submissionId = useRef(restored?.submissionId ?? newSubmissionId()).current;
  // Photos already uploaded, by file. A submit the server turns down (a slot
  // taken, a date too soon) used to upload every photo again on the next try -
  // 34MB, three times, for one customer on 5 Sep. Now each file goes up once.
  const uploaded = useRef(new Map<File, string>());
  // Guards against a second submit starting while one is in flight. The button
  // is disabled too, but state updates are async and a fast double tap can land
  // before the re-render that disables it.
  const inFlight = useRef(false);
  // Set the moment the server confirms the save. After that there is no draft
  // to rescue, and nothing may report this form as abandoned.
  const leadSaved = useRef(false);
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
  // When every time on the day they picked is taken: the next days with a
  // free time, offered as one tap each (from /api/availability, or from the
  // server's answer when a slot went between picking and sending).
  const [nextOpen, setNextOpen] = useState<{ date: string; slots: string[] }[]>([]);
  const minDate = useRef(minVisitDate()).current;

  // Funnel tracking (src/lib/funnel.ts): which step people reach, how long each
  // takes, and where they give up. Refs rather than state because none of it
  // is ever drawn, and the close handlers need the latest values without being
  // re-bound on every keystroke.
  const attemptId = useRef(newAttemptId()).current;
  const openedAt = useRef(Date.now());
  const stepStartedAt = useRef(Date.now());
  const finished = useRef(false);
  const track = useCallback(
    (input: Omit<TrackInput, "attempt_id" | "form">) =>
      trackFunnel({ attempt_id: attemptId, form: "modal", ...input }),
    [attemptId],
  );
  const stepMs = () => Date.now() - stepStartedAt.current;

  // `service` decides whose calendar this is: a lead goes to the contractor who
  // takes that job type. Checking against the primary contractor regardless,
  // which is what this used to do, answered about the wrong person's day for
  // every lead the routing rules send elsewhere.
  async function checkVisitDate(date: string, service: string) {
    setDateFull(false);
    setNextOpen([]);
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
        next_open?: { date: string; slots: string[] }[];
      };
      setDateFull(json.available === false);
      if (json.available === false) {
        setNextOpen(Array.isArray(json.next_open) ? json.next_open.slice(0, 3) : []);
        track({ event: "error", step: "schedule", mode, detail: "day_full" });
      }
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
    } finally {
      setDateChecking(false);
    }
  }

  const current: Step | "choice" = mode ? STEPS[stepIndex] : "choice";
  const totalSteps = STEPS.length;
  const stepNumber = stepIndex + 1;
  const isLastStep = stepIndex === STEPS.length - 1;

  // What is still stopping them on this step, in words the Funnel page can
  // count: "phone+address" means they left Contact with both unfinished. Only
  // which requirement - never what they typed.
  function unmet(): string {
    const missing: string[] = [];
    if (current === "contact") {
      if (data.name.trim().length < 2) missing.push("name");
      if (!isValidPhone(data.phone)) missing.push("phone");
      if (!hasSomeAddress(data.address)) missing.push("address");
    } else if (current === "service") {
      if (!data.service) missing.push("service");
    } else if (current === "schedule") {
      if (!data.visitDate) missing.push("date");
      if (!data.visitTime) missing.push("time");
      if (dateFull) missing.push("day_full");
    }
    return missing.length ? missing.join("+") : "ready";
  }

  // ── The safety net under the submit button ──
  // Once there's a name and a number, what they've typed goes to
  // /api/quote/draft as they go, and once more marked `left` if they close the
  // form or the tab without sending. If they never press the button - stuck on
  // the address, a phone call interrupting, an error they gave up on - the
  // office still has a number to call (CRM > Funnel, and a text to the owner).
  const draftRef = useRef({ data, mode, step: current as string });
  draftRef.current = { data, mode, step: current };
  const sendDraft = useCallback(
    (left: boolean) => {
      if (leadSaved.current) return;
      const { data: d, mode: m, step } = draftRef.current;
      if (d.name.trim().length < 2 || !isValidPhone(d.phone)) return;
      const body = JSON.stringify({
        submission_id: submissionId,
        name: d.name,
        phone: d.phone,
        email: d.email,
        address: d.address,
        service: d.service,
        mode: m,
        step,
        source_path: window.location.pathname,
        left,
      });
      try {
        // A beacon survives the tab closing, which is the case that matters.
        const sent =
          left &&
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon("/api/quote/draft", new Blob([body], { type: "application/json" }));
        if (!sent) {
          fetch("/api/quote/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Never allowed to get in the way of the form.
      }
    },
    [submissionId],
  );

  // Saved a moment after they stop typing, and on every step change.
  const contactKey = `${data.name}|${data.phone}|${data.address}|${data.email}|${data.service}|${current}`;
  useEffect(() => {
    if (leadSaved.current) return;
    const t = setTimeout(() => sendDraft(false), 1500);
    return () => clearTimeout(t);
  }, [contactKey, sendDraft]);

  // And kept in this tab, so reopening the form picks up where they were.
  useEffect(() => {
    if (leadSaved.current) return;
    storeSaved({ submissionId, mode, stepIndex, data, addressVerified });
  }, [submissionId, mode, stepIndex, data, addressVerified]);

  useEffect(() => {
    const onHide = () => sendDraft(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sendDraft]);

  // Everything the dismiss paths need, kept current for handlers that are
  // bound once (Escape, pagehide).
  const leaveRef = useRef({ step: current as string, mode, unmet: "ready" });
  leaveRef.current = { step: current, mode, unmet: unmet() };

  const recordClose = useCallback(
    (why?: string) => {
      if (finished.current) return;
      finished.current = true;
      const { step, mode: m, unmet: u } = leaveRef.current;
      track({ event: "close", step: step as TrackInput["step"], mode: m, ms: stepMs(), detail: why ?? u });
    },
    [track],
  );

  const dismiss = useCallback(() => {
    recordClose();
    sendDraft(true);
    onClose();
  }, [recordClose, onClose, sendDraft]);

  useEffect(() => {
    track({ event: "open" });
    // Closing the tab or navigating away with the form open is giving up too,
    // and the likeliest way to do it on a phone.
    const onHide = () => recordClose("left_page");
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [track, recordClose]);

  useEffect(() => {
    stepStartedAt.current = Date.now();
    track({ event: "view", step: current, mode });
    // `mode` only ever changes in the same render as the step does, so this is
    // still one view per step shown.
  }, [current, mode, track]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const set = (patch: Partial<FormState>) => setData((d) => ({ ...d, ...patch }));

  function pickMode(next: Mode) {
    track({ event: "done", step: "choice", mode: next, ms: stepMs() });
    setMode(next);
    setStepIndex(0);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const badType = incoming.find((f) => !isAllowedFile(f));
    if (badType) {
      track({ event: "error", step: current, mode, detail: "file_type" });
      setFileError(`"${badType.name}" isn't a photo or video. Please add images or video only.`);
      return;
    }
    const tooBig = incoming.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      track({ event: "error", step: current, mode, detail: "file_size" });
      setFileError(`"${tooBig.name}" is over ${MAX_FILE_MB}MB. Try a shorter video or smaller photo.`);
      return;
    }
    setFileError("");
    setFiles((prev) => [...prev, ...incoming].slice(0, 8));
  }

  function canProceed(): boolean {
    if (current === "contact") {
      // Name, a phone number, and something for an address. That's all that
      // stops anyone. The field still asks for the full address and lights up
      // green when it has one; a partial one is noted on the lead for the
      // office to confirm on the call. An email with a typo doesn't stop them
      // either - it's optional, and the server drops a bad one into a note.
      return data.name.trim().length >= 2 && isValidPhone(data.phone) && hasSomeAddress(data.address);
    }
    if (current === "service") return data.service !== "";
    if (current === "schedule") {
      const picked = /^\d{4}-\d{2}-\d{2}$/.test(data.visitDate) && data.visitTime !== "";
      // A full or non-working day only blocks an in-person request, which is
      // the only one taking a slot out of somebody's day. An online customer is
      // offering a fallback we may never use, so "that day is busy" is not a
      // reason to stop them submitting their photos.
      if (mode === "online") return picked && !dateChecking;
      return picked && !dateFull && !dateChecking;
    }
    return false;
  }

  // Moving between steps clears any stale complaint from the last submit, so a
  // fixed field doesn't keep showing the old reason it was rejected.
  function back() {
    track({ event: "back", step: current, mode, ms: stepMs() });
    setErrorMsg("");
    if (stepIndex === 0) setMode(null);
    else setStepIndex((i) => i - 1);
  }

  function next() {
    if (!canProceed()) return;
    setErrorMsg("");
    if (!isLastStep) {
      // Contact records whether the address came from the search or was typed
      // out by hand - a lot of typed ones says the autocomplete isn't helping.
      const detail = current === "contact" ? (addressVerified ? "address_picked" : "address_typed") : undefined;
      track({ event: "done", step: current, mode, ms: stepMs(), detail });
      setStepIndex((i) => i + 1);
    } else submit();
  }

  // Private bucket. The browser no longer has blanket write access: we ask our
  // server for a one-time signed upload URL (rate-limited + type-checked) and
  // PUT the file straight to it. We store only the object path on the lead row.
  //
  // Photos are optional, so they can never stop the request: a file that won't
  // go up (after one retry) is counted and skipped, the request is sent with
  // the rest, and the success screen asks them to text the missing ones. Until
  // 24 Sep one failed photo meant no lead at all - 31 Aug, six photos uploaded
  // and nothing saved.
  async function uploadFiles(): Promise<{ paths: string[]; failed: number }> {
    const paths: string[] = [];
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const already = uploaded.current.get(file);
      if (already) {
        paths.push(already);
        continue;
      }
      const label = files.length > 1 ? `Uploading photo ${i + 1} of ${files.length}` : "Uploading photo";
      setUploadNote(`${label}…`);
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          const contentType = fileMime(file);
          const ext = file.name.includes(".")
            ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "")
            : "bin";
          const signRes = await fetchWithTimeout(
            "/api/upload-url",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ext: ext || "bin", contentType }),
            },
            SIGN_TIMEOUT_MS,
          );
          if (!signRes.ok) throw new Error(`could not authorize upload (${signRes.status})`);
          const signed = (await signRes.json()) as { ok?: boolean; path?: string; uploadUrl?: string };
          if (!signed.ok || !signed.uploadUrl || !signed.path) throw new Error("could not authorize upload");
          await putFile(signed.uploadUrl, file, contentType, (f) =>
            setUploadNote(`${label}… ${Math.round(f * 100)}%`),
          );
          uploaded.current.set(file, signed.path);
          paths.push(signed.path);
          done = true;
        } catch {
          // Once more, then move on without it.
        }
      }
      if (!done) failed++;
    }
    setUploadNote("");
    return { paths, failed };
  }

  // The only way to the success screen. Read the rule in lib/quote-submit.ts
  // before changing anything here: success is shown when, and only when, the
  // server returns the id of the row it saved. Every other outcome - an error
  // body, a non-JSON body, a timeout, a thrown fetch, a response shape nobody
  // has thought of yet - lands on an error with our phone number, and the
  // form keeps everything they typed so pressing the button again just works.
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setErrorMsg("");
    // Recorded, then sent like any other request. The server decides what a
    // filled trap means (it saves it to Archived and tells the owner); the
    // browser never again answers on the server's behalf.
    if (honeypot.trim() !== "") track({ event: "error", step: current, mode, detail: "honeypot" });
    const fail = (detail: string, message: string) => {
      track({ event: "error", step: "schedule", mode, detail });
      setErrorMsg(message);
      setStatus("error");
    };
    try {
      let fileUrls: string[] = [];
      let failedCount = 0;
      if (files.length) {
        setStatus("uploading");
        const up = await uploadFiles();
        fileUrls = up.paths;
        failedCount = up.failed;
        if (failedCount) track({ event: "error", step: "schedule", mode, detail: "upload" });
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
        visit_date: data.visitDate,
        visit_time: data.visitTime,
        file_urls: fileUrls,
        files_failed: failedCount,
        source_path: typeof window !== "undefined" ? window.location.pathname : "",
        submission_id: submissionId,
        company: honeypot, // trap field, judged server-side
      };

      let res: Response;
      try {
        res = await fetchWithTimeout(
          "/api/quote",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
          SUBMIT_TIMEOUT_MS,
        );
      } catch (e) {
        // No answer at all: offline, dropped, or past the deadline. We don't
        // know whether it arrived, so we don't say it did. Retrying is safe.
        const timedOut = e instanceof DOMException && e.name === "AbortError";
        fail(
          timedOut ? "timeout" : "network",
          timedOut
            ? `We couldn't confirm your request arrived. Please press the button again (you won't be sent twice), or text or call us at ${phoneDisplay}.`
            : `We couldn't reach our server. Check your connection and press the button again, or text or call us at ${phoneDisplay}.`,
        );
        return;
      }

      const json = (await res.json().catch(() => null)) as {
        ok?: unknown;
        saved?: unknown;
        lead_id?: unknown;
        error?: string;
        fields?: string[];
      } | null;

      if (isConfirmedSave(res.status, json)) {
        finished.current = true;
        leadSaved.current = true;
        clearSaved();
        setFilesFailed(failedCount);
        setLeadRef(leadReference(json.lead_id));
        track({ event: "submit", step: "schedule", mode, ms: Date.now() - openedAt.current });
        setStatus("success");
        return;
      }

      const fields = Array.isArray(json?.fields) ? json.fields : [];
      const serverMsg = typeof json?.error === "string" && json.error ? json.error : "";
      // Why the server said no: the fields it named, or the status code.
      track({
        event: "error",
        step: "schedule",
        mode,
        detail: fields.length ? `server_${fields.slice(0, 4).join("+")}` : `server_${res.status}`,
      });
      if (fields.includes("address") || fields.includes("phone") || fields.includes("name")) {
        // Rejected on the contact details: take them back to that step rather
        // than showing the reason on a screen that can't fix it.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("contact"));
        setAddressVerified(false);
        setErrorMsg(serverMsg || "Please check your contact details.");
      } else if (res.status === 409 || fields.includes("visit_date") || fields.includes("visit_time")) {
        // Somebody took that time between them picking it and sending, or the
        // day is no longer bookable (a form left open past midnight). Back to
        // the schedule step to pick again - everything else stays filled in,
        // photos already uploaded stay uploaded, and the same submission id
        // goes with the next press. The server sends the next open days so
        // the new pick is one tap.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("schedule"));
        setErrorMsg(serverMsg || "That time isn't available any more. Please pick another.");
        const offered = (json as { next_open?: unknown } | null)?.next_open;
        void checkVisitDate(data.visitDate, data.service).then(() => {
          if (Array.isArray(offered) && offered.length) setNextOpen(offered.slice(0, 3) as typeof nextOpen);
        });
        set({ visitTime: "" });
      } else {
        // Includes a 2xx that isn't a confirmed save: whatever it is, it is
        // not proof the lead exists, so it is not a success.
        setErrorMsg(serverMsg || `We couldn't save your request just now. Please text or call us at ${phoneDisplay}.`);
        setStatus("error");
      }
    } catch {
      fail("client_exception", `Something went wrong. Please press the button again, or text or call us at ${phoneDisplay}.`);
    } finally {
      inFlight.current = false;
      setUploadNote("");
    }
  }

  const busy = status === "uploading" || status === "sending";
  const smsHref = smsFallbackHref(phoneHref, {
    name: data.name,
    phone: data.phone,
    address: data.address,
    service: data.service,
    mode: mode ?? "",
    when: data.visitDate ? `${prettyDay(data.visitDate)}${data.visitTime ? ` at ${data.visitTime}` : ""}` : "",
  });

  return (
    <div className="qm-overlay" onClick={dismiss} role="dialog" aria-modal="true" aria-label="Request a quote">
      {/* In Clarity recordings the headings, buttons, errors and the success
          screen stay readable - that is how you tell "gave up" from "was told
          no" from "sent it" when watching one back. What someone types, and
          the addresses suggested to them, are masked field by field below. */}
      <div className="qm-card" onClick={(e) => e.stopPropagation()}>
        <button className="qm-close" onClick={dismiss} aria-label="Close">
          <IconClose />
        </button>

        {/* Both, not either: a success screen with no saved row behind it is
            the exact bug this form has had three times. */}
        {status === "success" && leadRef ? (
          <div className="qm-body qm-success">
            <div className="qm-check">
              <IconCheck />
            </div>
            <h2 className="qm-title">You&apos;re all set!</h2>
            <p className="qm-sub">
              We got your request and we&apos;ll reach out the same day with your quote. Want to talk now? Give us a call.
            </p>
            {mode === "inperson" && data.visitDate && (
              <p className="qm-sub">
                Your visit: <strong>{prettyDay(data.visitDate)} at {data.visitTime}</strong>
              </p>
            )}
            {/* Photos are never why a request fails, so the ones that didn't
                upload get a way to follow on, not an error. */}
            {filesFailed > 0 && (
              <p className="qm-err">
                {filesFailed === 1 ? "One photo" : `${filesFailed} photos`} didn&apos;t upload.{" "}
                <a href={smsHref} className="qm-consent-link">
                  Text {filesFailed === 1 ? "it" : "them"} to us
                </a>{" "}
                at {phoneDisplay}.
              </p>
            )}
            {/* Proof it was saved: the reference is the start of the row's id,
                which only exists once the server has written it. */}
            <p className="qm-ref">
              Reference <strong>{leadRef}</strong>
            </p>
            <a href={phoneHref} className="cta-primary qm-full">
              Call {phoneDisplay}
            </a>
            <button className="qm-text-btn" onClick={onClose}>
              Close
            </button>
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
                <input data-clarity-mask="true"
                  className="qm-input"
                  value={data.name}
                  onChange={(e) => set({ name: e.target.value })}
                  autoComplete="name"
                  maxLength={120}
                  placeholder="First and last name"
                />
                <label className="qm-label qm-mt">Phone</label>
                <input data-clarity-mask="true"
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
                <input data-clarity-mask="true"
                  className="qm-input"
                  type="email"
                  value={data.email}
                  onChange={(e) => set({ email: e.target.value })}
                  autoComplete="email"
                  maxLength={200}
                  placeholder="you@email.com"
                />
                <span className="qm-ac-status qm-slot">
                  {!isValidEmail(data.email) ? "That email doesn't look right - check it, or leave it blank." : ""}
                </span>
                <p className="qm-hint">We save what you type as you go, so if anything goes wrong we can still call you back.</p>

                {/* A server-side rejection of the contact details lands here,
                    on the step that can actually fix it. */}
                {errorMsg && <p className="qm-err">{errorMsg}</p>}

                {/* The trap field. Its label and name
                    are deliberately nothing a browser or password manager
                    recognises: it used to be labelled "Company", and autofill
                    fills a Company field from a saved address - which turned a
                    real customer into a "bot" whose request vanished behind a
                    success screen. */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", top: "auto", height: 0, width: 0, overflow: "hidden" }}>
                  <label>
                    Leave this empty
                    <input data-clarity-mask="true"
                      type="text"
                      name="rcg_leave_blank"
                      tabIndex={-1}
                      autoComplete="off"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                      data-form-type="other"
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
                <select data-clarity-mask="true" className="qm-input" value={data.service} onChange={(e) => set({ service: e.target.value })}>
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
                <textarea data-clarity-mask="true"
                  className="qm-input"
                  rows={2}
                  value={data.details}
                  onChange={(e) => set({ details: e.target.value })}
                  placeholder="Roughly how much space (e.g. 600 sq ft or 20x30), your timeline, and anything else that helps…"
                />

                <label className="qm-dropzone qm-mt">
                  <input data-clarity-mask="true"
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
                  <ul className="qm-filelist" data-clarity-mask="true">
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
                <input data-clarity-mask="true"
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
                  ) : dateFull ? (
                    "That day is fully booked - pick another, or one of these:"
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

                {/* A full day is never a dead end: the next days with a free
                    time, one tap each. Picking one sets the day and re-checks
                    it, and the times redraw for that day. */}
                {nextOpen.length > 0 && (
                  <div className="qm-next-open">
                    <span className="qm-ac-status">Next open:</span>
                    <div className="qm-chips">
                      {nextOpen.map((d) => (
                        <button
                          key={d.date}
                          type="button"
                          className="qm-chip"
                          onClick={() => {
                            track({ event: "done", step: "schedule", mode, detail: "picked_next_open" });
                            setErrorMsg("");
                            set({ visitDate: d.date, visitTime: "" });
                            void checkVisitDate(d.date, data.service);
                          }}
                        >
                          {shortDay(d.date)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shown whenever there's a message, not only in the "error"
                    status: a rejected date bounces back here as idle, and the
                    reason has to come with it. */}
                {(status === "error" || errorMsg) && (
                  <p className="qm-err">{errorMsg || `Something went wrong. Please text or call us at ${phoneDisplay} instead.`}</p>
                )}
                {/* When we couldn't take it, sending it to us has to be one tap
                    and not a retelling: the text arrives with what they typed. */}
                {status === "error" && (
                  <div className="qm-fallback">
                    <a href={smsHref} className="cta-primary qm-full">
                      Text us this request
                    </a>
                    <a href={phoneHref} className="qm-text-btn">
                      Or call {phoneDisplay}
                    </a>
                  </div>
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
                  ? uploadNote || "Uploading…"
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
