import { NextResponse } from "next/server";

import { ADMIN_READY } from "@/lib/crm/env";
import { pgAdmin } from "@/lib/crm/rest";
import { parseFunnelEvent } from "@/lib/funnel";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Quote-funnel beacons (see src/lib/funnel.ts). One row per event into
// site_funnel_events, which only the service role can touch.
//
// Always answers 204: this is a beacon nobody is waiting on, and a visitor must
// never see an error because a step went uncounted. Rate-limited per IP so a
// script can't fill the table - a real person filling in the form sends a few
// dozen at most.
export async function POST(request: Request) {
  const noContent = new NextResponse(null, { status: 204 });
  if (!ADMIN_READY) return noContent;

  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 4000) return noContent;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return noContent;
  }
  const event = parseFunnelEvent(body);
  if (!event) return noContent;

  if (await rateLimit(`funnel:${clientIp(request)}`, 150, 10 * 60 * 1000)) return noContent;

  await pgAdmin("site_funnel_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(event),
  }).catch(() => {});
  return noContent;
}
