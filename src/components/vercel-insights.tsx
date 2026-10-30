"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Vercel Analytics and Speed Insights with URLs cleaned first. These routes carry a secret in the path:
//   /q/<token>        a customer's quote, no login
//   /confirm/<token>  confirms their booked day, no login
//   /join/<token>     one-shot contractor invite
//   /job/<token>      the crew's job page
//   /pay/<token>      the customer's payment page
//   /r/<token>        a payment receipt
// A token in the dashboard is a working link. Query strings are dropped too (?search= holds names and
// phones; /crm/login?next= carries a token). Only the route is reported.
const TOKEN_ROUTES = new Set(["q", "job", "confirm", "join", "pay", "r"]);

// Add any route that takes a secret in its path. Unparseable URLs return null and the datapoint is dropped.
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
          // Speed Insights derives the route from Next's params, covering every dynamic route; the list is a fallback.
          const url = event.route ? `${window.location.origin}${event.route}` : scrubUrl(event.url);
          return url ? { ...event, url } : null;
        }}
      />
    </>
  );
}
