"use client";

import { useEffect } from "react";

// Microsoft Clarity: heatmaps (where people click and how far they scroll),
// session recordings, and "rage click" / "dead click" detection. Free with no
// traffic cap, which is why it is here rather than anything on Vercel - Web
// Analytics on the Hobby plan has page views but no custom events, and no
// heatmaps on any plan.
//
// Off until NEXT_PUBLIC_CLARITY_PROJECT_ID is set in Vercel (Clarity ->
// Settings -> Overview -> Project ID). With it unset, nothing loads.
//
// Only on the public marketing pages. Never on:
//
//   the CRM          customers' names, numbers and prices on every screen
//   /q/ /pay/ ...    a secret in the URL, and one customer's quote on the page
//
// Those pages are only ever reached by a full page load (a texted link, the
// crm.* host), never by clicking through from the marketing site, so checking
// the first URL the tab loads is enough. The quote form itself is masked in
// recordings (data-clarity-mask on the form) so nothing typed into it is kept.
const PRIVATE_ROUTES = new Set(["crm", "q", "job", "confirm", "join", "pay"]);
const PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "";

export function Clarity() {
  useEffect(() => {
    if (!/^[a-z0-9]{6,20}$/i.test(PROJECT_ID)) return;
    if (window.location.hostname.startsWith("crm.")) return;
    if (PRIVATE_ROUTES.has(window.location.pathname.split("/")[1] ?? "")) return;
    if (window.clarity) return;

    // Microsoft's own loader, unminified: queue calls until the tag arrives.
    const queued = function (...args: unknown[]) {
      (queued.q = queued.q || []).push(args);
    } as ((...args: unknown[]) => void) & { q?: unknown[][] };
    window.clarity = queued;
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
    document.head.appendChild(tag);
  }, []);
  return null;
}
