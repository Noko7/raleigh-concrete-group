// Pure (testable with node --test). Counted per ATTEMPT (one form open), not per event: a step is reached
// once however often someone goes back and forth.
import { FUNNEL_STEPS, type FunnelEvent, type FunnelStep } from "./funnel.ts";

export type FunnelRow = Pick<FunnelEvent, "attempt_id" | "visitor_id" | "form" | "event" | "step" | "ms" | "mode" | "detail" | "path" | "device">;

export type StepStats = {
  step: FunnelStep;
  reached: number;
  completed: number;
  closedHere: number;
  /** Among those who got past it. */
  medianMs: number | null;
  /** Among those who gave up on it. */
  medianCloseMs: number | null;
};

export type Count = { key: string; count: number };
export type SplitRow = { key: string; opened: number; submitted: number };

export type FunnelStats = {
  opened: number;
  visitors: number;
  submitted: number;
  medianSubmitMs: number | null;
  steps: StepStats[];
  byMode: SplitRow[];
  byDevice: SplitRow[];
  byPath: SplitRow[];
  /** "contact · phone+address": where they closed and what was unfinished. */
  closeReasons: Count[];
  /** "schedule · day_full": every time the form said no. */
  errors: Count[];
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function tally(keys: string[], limit: number): Count[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function push(m: Map<string, number[]>, key: string, value: number) {
  const list = m.get(key);
  if (list) list.push(value);
  else m.set(key, [value]);
}

type Attempt = {
  visitor: string;
  path: string | null;
  device: string;
  mode: string | null;
  submitted: boolean;
  viewed: Set<string>;
  doneSteps: Set<string>;
};

export function funnelStats(rows: FunnelRow[]): FunnelStats {
  const modal = rows.filter((r) => r.form === "modal");
  const attempts = new Map<string, Attempt>();
  const doneMs = new Map<string, number[]>();
  const closeMs = new Map<string, number[]>();
  const closedAt = new Map<string, string>();
  const closeKeys: string[] = [];
  const errorKeys: string[] = [];
  const submitMs: number[] = [];

  for (const r of modal) {
    let a = attempts.get(r.attempt_id);
    if (!a) {
      a = {
        visitor: r.visitor_id,
        path: null,
        device: r.device,
        mode: null,
        submitted: false,
        viewed: new Set(),
        doneSteps: new Set(),
      };
      attempts.set(r.attempt_id, a);
    }
    if (r.mode) a.mode = r.mode;
    switch (r.event) {
      case "open":
        if (r.path) a.path = r.path;
        break;
      case "view":
        if (r.step) a.viewed.add(r.step);
        break;
      case "done":
        if (r.step) {
          a.doneSteps.add(r.step);
          if (r.ms !== null) push(doneMs, r.step, r.ms);
        }
        break;
      case "close":
        // Only the first close counts: a pagehide right after the close button is the same exit.
        if (r.step && !closedAt.has(r.attempt_id)) {
          closedAt.set(r.attempt_id, r.step);
          if (r.ms !== null) push(closeMs, r.step, r.ms);
          closeKeys.push(r.detail ? `${r.step} · ${r.detail}` : r.step);
        }
        break;
      case "error":
        errorKeys.push(`${r.step ?? "?"} · ${r.detail ?? "unknown"}`);
        break;
      case "submit":
        if (!a.submitted && r.ms !== null) submitMs.push(r.ms);
        a.submitted = true;
        break;
    }
  }

  // Every attempt seen counts as opened: open beacons get lost (ad blockers, dropped connections).
  const list = [...attempts.values()];

  const closedCount = new Map<string, number>();
  for (const step of closedAt.values()) closedCount.set(step, (closedCount.get(step) ?? 0) + 1);

  const steps: StepStats[] = FUNNEL_STEPS.map((step) => ({
    step,
    // Every attempt starts at choice, whether or not its view landed.
    reached: step === "choice" ? list.length : list.filter((a) => a.viewed.has(step) || a.doneSteps.has(step)).length,
    completed: list.filter((a) => a.doneSteps.has(step) || (step === "schedule" && a.submitted)).length,
    closedHere: closedCount.get(step) ?? 0,
    medianMs: median(doneMs.get(step) ?? []),
    medianCloseMs: median(closeMs.get(step) ?? []),
  }));

  function split(keyOf: (a: Attempt) => string | null, limit = 20): SplitRow[] {
    const m = new Map<string, SplitRow>();
    for (const a of list) {
      const key = keyOf(a);
      if (!key) continue;
      const row = m.get(key) ?? { key, opened: 0, submitted: 0 };
      row.opened += 1;
      if (a.submitted) row.submitted += 1;
      m.set(key, row);
    }
    return [...m.values()].sort((x, y) => y.opened - x.opened || x.key.localeCompare(y.key)).slice(0, limit);
  }

  return {
    opened: list.length,
    visitors: new Set(list.map((a) => a.visitor)).size,
    submitted: list.filter((a) => a.submitted).length,
    medianSubmitMs: median(submitMs),
    steps,
    byMode: split((a) => a.mode),
    byDevice: split((a) => a.device),
    byPath: split((a) => a.path, 12),
    closeReasons: tally(closeKeys, 12),
    errors: tally(errorKeys, 12),
  };
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
