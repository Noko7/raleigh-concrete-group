"use client";

import { useEffect } from "react";

import { recordCrewView } from "./crew-view-actions";

// From the browser so prefetches and post-save refreshes don't count. A reload within this window is the
// same visit.
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
