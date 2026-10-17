"use client";

import { useEffect } from "react";

import { recordCrewView } from "./crew-view-actions";

// Counts the contractor opening this job, from the browser so a prefetch or a
// page refresh after saving something doesn't count. A reload within a couple
// of minutes is the same visit, not a second one.
const SAME_VISIT_MS = 2 * 60 * 1000;

export function CrewViewBeacon({ token }: { token: string }) {
  useEffect(() => {
    const key = `crew_viewed_${token}`;
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < SAME_VISIT_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage blocked: count it anyway.
    }
    recordCrewView(token).catch(() => {});
  }, [token]);
  return null;
}
