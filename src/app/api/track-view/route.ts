import { NextResponse } from "next/server";

import { recordCustomerView } from "@/lib/crm/queries";

export async function POST(request: Request) {
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return NextResponse.json({ ok: false }, { status: 400 });

  await recordCustomerView(token);
  return NextResponse.json({ ok: true });
}
