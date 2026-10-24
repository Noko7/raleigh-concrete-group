"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ymdInDays } from "@/lib/crm/clock";
import { DEFAULT_VISIT_SLOTS, VISIT_LEAD_DAYS } from "@/lib/crm/constants";
import { newAttemptId, trackFunnel, type TrackInput } from "@/lib/funnel-client";
import {
  isConfirmedSave,
  leadReference,
  newSubmissionId,
  smsFallbackHref,
  UUID_RE,
} from "@/lib/quote-submit";
import { phoneDisplay, phoneHref } from "@/lib/site-data";
import { ChoiceStep } from "./quote-modal/ChoiceStep";
import { ContactStep } from "./quote-modal/ContactStep";
import { IconBack, IconClose } from "./quote-modal/icons";
import { ScheduleStep } from "./quote-modal/ScheduleStep";
import { ServiceStep } from "./quote-modal/ServiceStep";
import { isValidPhone, prettyDay, type FormState, type Mode, type Status } from "./quote-modal/shared";
import { SuccessStep } from "./quote-modal/SuccessStep";

// Everything is saved through our server (/api/upload-url, /api/quote); the browser never checks Supabase
// settings itself. If the server can't save, it says so.
const MAX_FILE_MB = 50;
// Enough for "cracked driveway, about 20x30".
const MIN_ONLINE_DETAILS = 10;

// Generous: the request is small and the server answers before sending texts, so past this is a hang.
// Retrying after a timeout is safe (see submissionId).
const SUBMIT_TIMEOUT_MS = 30_000;
const SIGN_TIMEOUT_MS = 15_000;
// Given up only when no bytes move for this long: a large video on weak signal is slow but fine.
const UPLOAD_STALL_MS = 45_000;

// Kept for this tab so an accidental close doesn't lose what they typed. Carries the submission id so a
// reopened form is the same request. Cleared once sent. Photos can't be kept.
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

// Gives up only when the upload stalls.
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

// An AbortError is thrown, and the caller treats it like any other failure to confirm.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

// Both modes ask for a date, meaning different things:
//   in-person  booking a visit, confirmed on the spot
//   online     a fallback slot if photos aren't enough; nobody comes unless a contractor confirms
const STEPS = ["contact", "service", "schedule"] as const;

type Step = (typeof STEPS)[number];

// Real slots come from /api/availability: they belong to the contractor this job type routes to.
const DEFAULT_SLOTS = DEFAULT_VISIT_SLOTS;

// YYYY-MM-DD. The server checks too: `min` on a date input is a convenience, not a rule.
function minVisitDate(): string {
  return ymdInDays(VISIT_LEAD_DAYS);
}

function cityFromAddress(address: string): string {
  const parts = address.split(",").map((p) => p.trim());
  return parts.length >= 2 ? parts[1] : "";
}

// A partial address doesn't block: it's a phone call, whereas a lead that gave up is nothing. The field
// still asks for (and greens) a full one; the server notes partials on the lead.
function hasSomeAddress(a: string): boolean {
  return a.trim().length >= 5;
}
// Phones (especially iOS) report empty or generic MIME types for HEIC and .mov; infer from the extension
// so Storage's allow-list accepts the file.
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

function Modal({ onClose }: { onClose: () => void }) {
  // Restored if they closed it earlier in this tab.
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
  // The success screen can't render without this: it exists only once the server returns the saved row's id.
  const [leadRef, setLeadRef] = useState("");
  // So the success screen is honest: was a visit actually booked, how many photos didn't make it.
  const [visitBooked, setVisitBooked] = useState(true);
  const [filesFailed, setFilesFailed] = useState(0);
  const [uploadNote, setUploadNote] = useState("");
  // Sent on every attempt (lib/quote-submit.ts); a unique index makes a retry find the saved lead.
  const submissionId = useRef(restored?.submissionId ?? newSubmissionId()).current;
  // Uploaded paths by file, so a submit the server turns down doesn't re-upload every photo.
  const uploaded = useRef(new Map<File, string>());
  // The button is disabled too, but a fast double tap can land before that re-render.
  const inFlight = useRef(false);
  // After the server confirms, nothing may report this form as abandoned.
  const leadSaved = useRef(false);
  const [dateChecking, setDateChecking] = useState(false);
  const [dateFull, setDateFull] = useState(false);
  // Greyed out as a courtesy only; the server re-checks because "free" goes stale immediately.
  const [takenTimes, setTakenTimes] = useState<string[]>([]);
  // From the contractor's own working hours.
  const [slots, setSlots] = useState<string[]>(DEFAULT_SLOTS);
  // Distinct from "every hour taken": the answer is a different day, not a different time.
  const [dayOff, setDayOff] = useState(false);
  const minDate = useRef(minVisitDate()).current;

  // Funnel tracking (src/lib/funnel.ts). Refs: never drawn, and bound-once close handlers need the latest values.
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

  // `service` decides whose calendar: a lead goes to the contractor who takes that job type.
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
      // Only in-person is stopped by a full or non-working day (see canProceed).
      if (mode === "inperson" && (json.available === false || json.works === false)) {
        track({ event: "error", step: "schedule", mode, detail: json.works === false ? "day_off" : "day_full" });
      }
      const open = Array.isArray(json.slots) && json.slots.length > 0 ? json.slots : DEFAULT_SLOTS;
      const taken = Array.isArray(json.taken) ? json.taken : [];
      setSlots(open);
      setTakenTimes(taken);
      // Drop a chosen time that's no longer available, rather than a chip that will be rejected on submit.
      setData((d) =>
        d.visitTime && (taken.includes(d.visitTime) || !open.includes(d.visitTime))
          ? { ...d, visitTime: "" }
          : d,
      );
    } catch {
      // Don't block on a network hiccup; the server re-checks.
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

  // An online quote is priced from what they send: at least one photo and a few words are required.
  const onlineNeedsMore = mode === "online";
  const hasPhoto = files.length > 0;
  const hasDetails = data.details.trim().length >= MIN_ONLINE_DETAILS;

  // Countable by the Funnel page: "phone+address" = left Contact with both unfinished. Never what they typed.
  function unmet(): string {
    const missing: string[] = [];
    if (current === "contact") {
      if (data.name.trim().length < 2) missing.push("name");
      if (!isValidPhone(data.phone)) missing.push("phone");
      if (!hasSomeAddress(data.address)) missing.push("address");
    } else if (current === "service") {
      if (!data.service) missing.push("service");
      if (onlineNeedsMore && !hasPhoto) missing.push("photo");
      if (onlineNeedsMore && !hasDetails) missing.push("details");
    } else if (current === "schedule") {
      if (!data.visitDate) missing.push("date");
      if (!data.visitTime) missing.push("time");
      if (mode === "inperson" && dateFull) missing.push("day_full");
      if (mode === "inperson" && dayOff) missing.push("day_off");
    }
    return missing.length ? missing.join("+") : "ready";
  }

  // Safety net: once there's a name and number, input is posted to /api/quote/draft as they go, and once
  // more marked `left` if they leave without sending, so the office still has a number to call.
  // Closing the form is not leaving (people reopen it seconds later), so a close only ARMS the alert
  // (armLeftAlert): it fires if they leave the page or don't return within a few minutes.
  const draftRef = useRef({ data, mode, step: current as string });
  draftRef.current = { data, mode, step: current };
  const sendDraft = useCallback(
    (left: boolean, defer = false) => {
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
      if (left && defer) {
        // Plain draft now; flagged as left only if they don't return.
        postDraft(JSON.stringify({ ...JSON.parse(body), left: false }), false);
        armLeftAlert(body);
        return;
      }
      postDraft(body, left);
    },
    [submissionId],
  );

  // Reopened or fresh: cancel any alert an earlier close armed.
  useEffect(() => {
    cancelLeftAlert();
  }, []);

  // Debounced, and on every step change.
  const contactKey = `${data.name}|${data.phone}|${data.address}|${data.email}|${data.service}|${current}`;
  useEffect(() => {
    if (leadSaved.current) return;
    const t = setTimeout(() => sendDraft(false), 1500);
    return () => clearTimeout(t);
  }, [contactKey, sendDraft]);

  useEffect(() => {
    if (leadSaved.current) return;
    storeSaved({ submissionId, mode, stepIndex, data, addressVerified });
  }, [submissionId, mode, stepIndex, data, addressVerified]);

  useEffect(() => {
    const onHide = () => sendDraft(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sendDraft]);

  // Kept current for handlers bound once (Escape, pagehide).
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
    sendDraft(true, true);
    onClose();
  }, [recordClose, onClose, sendDraft]);

  useEffect(() => {
    track({ event: "open" });
    // Leaving the page with the form open is giving up too (the likeliest way on a phone).
    const onHide = () => recordClose("left_page");
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [track, recordClose]);

  useEffect(() => {
    stepStartedAt.current = Date.now();
    track({ event: "view", step: current, mode });
    // `mode` only changes in the same render as the step, so this is still one view per step.
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
      // Only name, phone and some address block. Partial addresses are noted for the office to confirm; email is
      // optional and the server moves a bad one into a note.
      return data.name.trim().length >= 2 && isValidPhone(data.phone) && hasSomeAddress(data.address);
    }
    if (current === "service") return data.service !== "" && (!onlineNeedsMore || (hasPhoto && hasDetails));
    if (current === "schedule") {
      const picked = /^\d{4}-\d{2}-\d{2}$/.test(data.visitDate) && data.visitTime !== "";
      // Only in-person takes a slot from someone's day; an online fallback day being busy is no reason to stop.
      if (mode === "online") return picked && !dateChecking;
      return picked && !dateFull && !dayOff && !dateChecking;
    }
    return false;
  }

  // Clear stale submit errors so a fixed field doesn't show the old reason.
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
      // Picked vs typed address: many typed ones means the autocomplete isn't helping.
      const detail = current === "contact" ? (addressVerified ? "address_picked" : "address_typed") : undefined;
      track({ event: "done", step: current, mode, ms: stepMs(), detail });
      setStepIndex((i) => i + 1);
    } else submit();
  }

  // Private bucket: the server issues one-time signed upload URLs (rate-limited, type-checked); we store
  // only the object path.
  // Photos are optional and never block the request: a file that fails twice is counted and skipped, and
  // the success screen asks for it by text.
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

  // The only way to the success screen; read lib/quote-submit.ts first. Success only when the server returns
  // the saved row's id. Anything else shows an error with our number and keeps the input for a retry.
  async function submit(opts: { skipVisit?: boolean } = {}) {
    if (inFlight.current) return;
    inFlight.current = true;
    setErrorMsg("");
    // The server decides what a filled trap means (saves to Archived, tells the owner).
    if (honeypot.trim() !== "") track({ event: "error", step: current, mode, detail: "honeypot" });
    const fail = (detail: string, message: string) => {
      track({ event: "error", step: "schedule", mode, detail });
      setErrorMsg(message);
      setStatus("error");
    };
    // A restored draft has no photos (the browser can't keep them), so re-check here.
    if (onlineNeedsMore && (!hasPhoto || !hasDetails)) {
      inFlight.current = false;
      setStepIndex(STEPS.indexOf("service"));
      setErrorMsg(
        !hasPhoto
          ? "Please add at least one photo of the spot so we can price it."
          : "Please tell us a little about the job so we can price it.",
      );
      return;
    }
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
      // No photo arrived: stop and let them retry (the draft is already visible to the office).
      if (onlineNeedsMore && fileUrls.length === 0) {
        inFlight.current = false;
        setStatus("idle");
        setErrorMsg(
          `Your photo didn't upload. Check your connection and tap the button again, or text it to us at ${phoneDisplay}.`,
        );
        return;
      }
      setStatus("sending");
      const skip = Boolean(opts.skipVisit);
      const payload = {
        name: data.name,
        phone: data.phone,
        email: data.email,
        service: data.service,
        address: data.address,
        city: cityFromAddress(data.address),
        details: data.details,
        quote_type: mode ?? "inperson",
        visit_date: skip ? "" : data.visitDate,
        visit_time: skip ? "" : data.visitTime,
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
        // No answer (offline, dropped, timed out): it may have arrived, so don't claim it did. Retrying is safe.
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
        cancelLeftAlert();
        clearSaved();
        setVisitBooked(json.visit_booked !== false);
        setFilesFailed(failedCount);
        setLeadRef(leadReference(json.lead_id));
        track({ event: "submit", step: "schedule", mode, ms: Date.now() - openedAt.current });
        setStatus("success");
        return;
      }

      const fields = Array.isArray(json?.fields) ? json.fields : [];
      const serverMsg = typeof json?.error === "string" && json.error ? json.error : "";
      track({
        event: "error",
        step: "schedule",
        mode,
        detail: fields.length ? `server_${fields.slice(0, 4).join("+")}` : `server_${res.status}`,
      });
      if (fields.includes("address") || fields.includes("phone") || fields.includes("name")) {
        // Contact rejected: back to the step that can fix it.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("contact"));
        setAddressVerified(false);
        setErrorMsg(serverMsg || "Please check your contact details.");
      } else if (fields.includes("photo") || fields.includes("details")) {
        // Missing photo or description: back to the step that adds them.
        setStatus("idle");
        setStepIndex(STEPS.indexOf("service"));
        setErrorMsg(serverMsg || "Please add a photo and a short description of the job.");
      } else {
        // Includes a 2xx that isn't a confirmed save. (A slot lost meanwhile isn't a refusal: the server saves
        // the lead without it.)
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
      {/*
        Clarity sees headings, buttons, errors and the success screen; typed values and address suggestions
        are masked field by field below.
      */}
      <div className="qm-card" onClick={(e) => e.stopPropagation()}>
        <button className="qm-close" onClick={dismiss} aria-label="Close">
          <IconClose />
        </button>

        {/* Both: a success screen needs a saved row behind it. */}
        {status === "success" && leadRef ? (
          <SuccessStep
            mode={mode}
            visitBooked={visitBooked}
            data={data}
            filesFailed={filesFailed}
            smsHref={smsHref}
            leadRef={leadRef}
            onClose={onClose}
          />
        ) : (
          <>
            {mode && (
              <div className="qm-progress">
                <div className="qm-progress-bar" style={{ width: `${(stepNumber / totalSteps) * 100}%` }} />
              </div>
            )}

            {current === "choice" && (
              <ChoiceStep
                pickMode={pickMode}
              />
            )}

            {current === "contact" && (
              <ContactStep
                totalSteps={totalSteps}
                data={data}
                set={set}
                addressVerified={addressVerified}
                setAddressVerified={setAddressVerified}
                errorMsg={errorMsg}
                honeypot={honeypot}
                setHoneypot={setHoneypot}
              />
            )}

            {current === "service" && (
              <ServiceStep
                totalSteps={totalSteps}
                mode={mode}
                data={data}
                set={set}
                files={files}
                setFiles={setFiles}
                addFiles={addFiles}
                fileError={fileError}
                hasDetails={hasDetails}
                errorMsg={errorMsg}
              />
            )}

            {/* In-person books a visit; online picks a fallback slot. */}
            {current === "schedule" && (
              <ScheduleStep
                totalSteps={totalSteps}
                mode={mode}
                minDate={minDate}
                data={data}
                set={set}
                checkVisitDate={checkVisitDate}
                dateChecking={dateChecking}
                dateFull={dateFull}
                dayOff={dayOff}
                slots={slots}
                takenTimes={takenTimes}
                busy={busy}
                track={track}
                stepMs={stepMs}
                submit={submit}
                status={status}
                errorMsg={errorMsg}
                smsHref={smsHref}
              />
            )}

            {/* SMS consent disclosure (A2P 10DLC), shown before submitting. */}
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

            {mode && (
            <div className="qm-footer">
              <button className="qm-back" onClick={back} disabled={busy} aria-label="Back">
                <IconBack />
              </button>
              <button className="cta-primary qm-next" onClick={next} disabled={!canProceed() || busy}>
                {status === "uploading"
                  ? uploadNote || "Uploading…"
                  : status === "sending"
                    ? "Sending…"
                    : !isLastStep
                      ? "Next"
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

// Abandoned-form alert. Module-level so it outlives the modal unmounting.
const LEFT_GRACE_MS = 5 * 60 * 1000;
let pendingLeft: { timer: ReturnType<typeof setTimeout>; fire: () => void } | null = null;

function postDraft(body: string, left: boolean) {
  try {
    // A beacon survives the tab closing.
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
    // Must never get in the way of the form.
  }
}

function cancelLeftAlert() {
  if (!pendingLeft) return;
  clearTimeout(pendingLeft.timer);
  window.removeEventListener("pagehide", pendingLeft.fire);
  pendingLeft = null;
}

function armLeftAlert(body: string) {
  cancelLeftAlert();
  const fire = () => {
    cancelLeftAlert();
    postDraft(body, true);
  };
  pendingLeft = { timer: setTimeout(fire, LEFT_GRACE_MS), fire };
  window.addEventListener("pagehide", fire);
}

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
