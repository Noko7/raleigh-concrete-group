import { NextResponse } from "next/server";

import { MAX_JOBS_PER_DAY, countJobsOn, resolveAssignee, visitAvailability } from "@/lib/crm/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Public, token-free availability for the customer scheduling UIs.
//   type=job    booked work days: one per day for the whole business, so yes/no on the date
//   type=quote  in-person visits: stack an hour apart on ONE contractor's calendar, so that person's slots
//               and which are taken
// Times only, never names: anyone can call this.
// `service` decides whose calendar: leads route by staff.service_types, falling back to the primary contractor.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "quote" ? "quote" : "job";
  const date = (searchParams.get("date") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Invalid date." }, { status: 400 });
  }

  // Each call is a DB read and the middleware limiter only covers the CRM. Sized for someone clicking
  // through a month of dates.
  if (await rateLimit(`avail:${clientIp(request)}`, 90, 5 * 60 * 1000)) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  if (type === "job") {
    const used = await countJobsOn(date);
    const remaining = Math.max(0, MAX_JOBS_PER_DAY - used);
    return NextResponse.json({ ok: true, available: remaining > 0, remaining, capacity: MAX_JOBS_PER_DAY });
  }

  const service = (searchParams.get("service") || "").slice(0, 120);
  const { slots, taken, wholeDay, works } = await visitAvailability(await resolveAssignee(service), date);

  return NextResponse.json({
    ok: true,
    // Full however it happened: every hour booked, an all-day pour, or a day off.
    available: works && !wholeDay && taken.length < slots.length,
    slots,
    taken,
    wholeDay,
    works,
  });
}
