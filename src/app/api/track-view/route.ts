import { NextResponse } from "next/server";

import { recordCustomerView } from "@/lib/crm/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// One beacon per customer opening their quote page. Rate-limited because each
// call is two writes - a view_count bump and a quote_events row - and "how many
// times have they looked at it" is a number the office reads as buying signal.
// Left unlimited, anybody holding a link could run that count to any figure
// they liked and bury the real activity log under it.
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return NextResponse.json({ ok: false }, { status: 400 });

  // Keyed on the token, not the IP: a genuine reopen from a new network should
  // still register, and the thing worth bounding is views of one quote.
  // Answered 200 rather than 429 - this is a beacon nobody is waiting on, and
  // the page must not show an error because a view went uncounted.
  if (await rateLimit(`view:${token}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: true });
  }

  await recordCustomerView(token);
  return NextResponse.json({ ok: true });
}
