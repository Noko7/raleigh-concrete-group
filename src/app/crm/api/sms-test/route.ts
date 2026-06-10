import { NextResponse } from "next/server";

import { getSession } from "@/lib/crm/auth";
import { SMS_PROVIDER, sendSmsResult, toE164 } from "@/lib/crm/notify";

// Owner-only SMS diagnostic. Visit /crm/api/sms-test (logged in as an owner) to
// see which provider/env are detected and the exact response from the SMS API.
// Optionally pass ?to=+19198977695 to text a specific number; defaults to
// OWNER_PHONE. Sends a single test message.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") {
    return NextResponse.json({ ok: false, error: "Owners only." }, { status: 403 });
  }

  const url = new URL(request.url);
  const toRaw = url.searchParams.get("to") || process.env.OWNER_PHONE || session.staff.phone || "";

  const config = {
    provider: SMS_PROVIDER,
    QUO_API_KEY: Boolean(process.env.QUO_API_KEY),
    QUO_FROM: process.env.QUO_FROM || null,
    QUO_FROM_e164: toE164(process.env.QUO_FROM || ""),
    QUO_USER_ID: Boolean(process.env.QUO_USER_ID),
    OWNER_PHONE: process.env.OWNER_PHONE || null,
    OWNER_PHONE_e164: toE164(process.env.OWNER_PHONE || ""),
    owner_staff_phone: session.staff.phone || null,
    sending_to: toRaw || null,
    sending_to_e164: toE164(toRaw),
  };

  if (!toRaw) {
    return NextResponse.json({ ok: false, config, error: "No destination. Set OWNER_PHONE or pass ?to=+1..." });
  }

  const result = await sendSmsResult(toRaw, "Raleigh Concrete CRM — SMS test. If you got this, texts work.");
  return NextResponse.json({ ok: result.ok, config, result });
}
