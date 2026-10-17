"use client";

import { useEffect } from "react";

import { CLARITY_PROJECT_ID } from "@/lib/clarity-id";

// Microsoft Clarity (heatmaps, recordings, rage/dead clicks): free with no traffic cap. ID in
// src/lib/clarity-id.ts.
// Public marketing pages only. Never the CRM (customer details on every screen) or token pages (secret in
// the URL). Those are only reached by a full page load, so checking the first URL is enough. The quote form
// is masked (data-clarity-mask).
const PRIVATE_ROUTES = new Set(["crm", "q", "job", "confirm", "join", "pay"]);

export function Clarity() {
  useEffect(() => {
    if (!/^[a-z0-9]{6,20}$/i.test(CLARITY_PROJECT_ID)) return;
    if (window.location.hostname.startsWith("crm.")) return;
    if (PRIVATE_ROUTES.has(window.location.pathname.split("/")[1] ?? "")) return;
    if (window.clarity) return;

    // Microsoft's loader: queue calls until the tag arrives.
    const queued = function (...args: unknown[]) {
      (queued.q = queued.q || []).push(args);
    } as ((...args: unknown[]) => void) & { q?: unknown[][] };
    window.clarity = queued;
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
    document.head.appendChild(tag);
  }, []);
  return null;
}
