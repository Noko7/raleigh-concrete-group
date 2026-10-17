// Browser side of the quote funnel (see funnel.ts). sendBeacon where available because it survives the
// page closing, which is the event that matters. Must never throw into the form or hold it up.
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

// Per tab, to tell 12 people from one person 12 times. sessionStorage: gone with the tab, never sent
// with anything else.
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

    // Mirrored into Clarity (when loaded) so recordings can be filtered by funnel step.
    window.clarity?.("event", `quote_${event.event}${event.step ? `_${event.step}` : ""}`);

    const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/funnel", new Blob([body], { type: "application/json" }));
    if (!sent) {
      fetch("/api/funnel", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Analytics never breaks the form.
  }
}
