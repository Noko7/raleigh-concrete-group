import { NextResponse } from "next/server";

import { ADMIN_READY } from "@/lib/crm/env";
import { pgAdmin } from "@/lib/crm/rest";
import { parseFunnelEvent } from "@/lib/funnel";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Quote-funnel beacons (see src/lib/funnel.ts) into site_funnel_events (service role only).
// Always 204: a visitor must never see an error over an uncounted step. Rate-limited per IP.
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
