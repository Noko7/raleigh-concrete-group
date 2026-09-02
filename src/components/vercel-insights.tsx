"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Vercel's Web Analytics and Speed Insights, with the URLs cleaned up first.
//
// Both send the page URL with every datapoint, and four of this app's routes
// carry a secret in the path:
//
//   /q/<token>        opens a customer's quote with no login at all
//   /confirm/<token>  confirms their booked day, same
//   /join/<token>     one-shot contractor invite: sets up a CRM login
//   /job/<token>      the crew's job page (this one needs a session too)
//
// Left alone, those tokens would be sitting in the analytics dashboard, and a
// quote link pasted out of it works for whoever has it. Query strings go the
// same way: the CRM's ?search= is whatever the office typed, usually a
// customer's name or phone, and /crm/login?next=... carries a token of its own.
//
// So neither leaves the browser. What's reported is the route - /q/[token] -
// which is the only part any performance question is actually asked about.
const TOKEN_ROUTES = new Set(["q", "job", "confirm", "join"]);

// Add a route here if it ever takes a secret in its path. Speed Insights
// doesn't need the list (see below); this is Web Analytics' only defence.
// Returns null for a URL it can't parse, which drops the datapoint - one
// missing page view beats one leaked token.
export function scrubUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/");
    if (TOKEN_ROUTES.has(parts[1] ?? "") && parts[2]) parts[2] = "[token]";
    return `${url.origin}${parts.join("/")}`;
  } catch {
    return null;
  }
}

export function VercelInsights() {
  return (
    <>
      <Analytics
        beforeSend={(event) => {
          const url = scrubUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
      <SpeedInsights
        beforeSend={(event) => {
          // Speed Insights works the route out itself, from Next's own params,
          // so it covers every dynamic route including any added after this
          // file was written. The list above is only the fallback.
          const url = event.route ? `${window.location.origin}${event.route}` : scrubUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
    </>
  );
}
