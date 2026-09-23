// Browser side of the quote funnel (see funnel.ts for what is recorded and why).
//
// Fire-and-forget: sendBeacon where it exists, because it survives the page
// being closed - and "closed the page halfway through" is the event this whole
// thing is for. Nothing here can throw into the form or hold it up.
import { scrubPath, type FunnelEvent } from "./funnel";

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

// One id per browser tab, so the page can tell "12 people opened it" from "one
// person opened it 12 times". sessionStorage, not a cookie: it is gone when the
// tab closes and is never sent to the server with anything else.
let memVisitor = "";
function visitorId(): string {
  try {
    const existing = sessionStorage.getItem("rcg_funnel_vid");
    if (existing) return existing;
    const id = randomId();
    sessionStorage.setItem("rcg_funnel_vid", id);
    return id;
  } catch {
    return (memVisitor ||= randomId());
  }
}

export function newAttemptId(): string {
  return randomId();
}

function device(): "mobile" | "desktop" {
  try {
    return window.matchMedia("(max-width: 767px), (pointer: coarse)").matches ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

export type TrackInput = Pick<FunnelEvent, "attempt_id" | "form" | "event"> &
  Partial<Pick<FunnelEvent, "step" | "ms" | "mode" | "detail">>;

export function trackFunnel(input: TrackInput): void {
  if (typeof window === "undefined") return;
  try {
    const event: FunnelEvent = {
      step: null,
      ms: null,
      mode: null,
      detail: null,
      ...input,
      visitor_id: visitorId(),
      path: scrubPath(window.location.pathname),
      device: device(),
    };
    const body = JSON.stringify(event);

    // Mirrored into Microsoft Clarity when it is loaded (see clarity.tsx), so
    // its recordings can be filtered to "people who gave up on Contact" and
    // watched. A no-op when Clarity isn't configured.
    window.clarity?.("event", `quote_${event.event}${event.step ? `_${event.step}` : ""}`);

    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/funnel", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Analytics never gets to break the form.
  }
}
