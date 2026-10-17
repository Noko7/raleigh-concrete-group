import { NextResponse } from "next/server";

import { recordCustomerView } from "@/lib/crm/queries";
import { rateLimit } from "@/lib/rate-limit";

// Each call is two writes, and the office reads the view count as buying signal, so a link holder must
// not be able to inflate it.
export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return NextResponse.json({ ok: false }, { status: 400 });

  // Keyed on the token (a reopen from a new network should count). 200, not 429: nobody waits on a beacon.
  if (await rateLimit(`view:${token}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: true });
  }

  await recordCustomerView(token);
  return NextResponse.json({ ok: true });
}
