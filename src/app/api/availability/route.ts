import { NextResponse } from "next/server";

import { MAX_JOBS_PER_DAY, countJobsOn, resolveAssignee, visitAvailability } from "@/lib/crm/queries";

// Public, token-free availability check used by the customer scheduling UIs.
//
//   type=job    booked work days. Still one a day for the whole business, so
//               the answer is a yes/no on the date.
//   type=quote  in-person quote visits. These stack an hour apart on ONE
//               contractor's calendar, so the answer is that person's slots for
//               the day and which of them are spoken for.
//
// Times only, never names: this endpoint answers to anyone, so it must not leak
// who is on the calendar or which customer is in a slot.
//
// The `service` parameter is what decides whose calendar is read. A lead routes
// to the contractor who takes that job type (staff.service_types), falling back
// to the primary contractor - so checking against the primary regardless, as
// this used to, answered about the wrong person's day for every lead the
// routing rules sent elsewhere.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "quote" ? "quote" : "job";
  const date = (searchParams.get("date") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Invalid date." }, { status: 400 });
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
    // A day with no slot left on it is full, however that came about: every
    // hour booked, a pour taking the whole day, or a day they don't work.
    available: works && !wholeDay && taken.length < slots.length,
    slots,
    taken,
    wholeDay,
    works,
  });
}
