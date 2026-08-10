import { NextResponse } from "next/server";

import {
  MAX_JOBS_PER_DAY,
  MAX_VISITS_PER_DAY,
  countJobsOn,
  countVisitsOn,
  getPrimaryContractorId,
  takenVisitTimes,
} from "@/lib/crm/queries";

// Public, token-free availability check used by the customer scheduling UIs.
// type=job  → booked work days (max 1/day)
// type=quote → in-person quote visits (max 5/day, and never two in one slot)
//
// For quote visits this also returns which times the crew already has, so the
// form can grey those chips out. Times only, never names: this endpoint answers
// to anyone, so it must not leak who is on the calendar.
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

  const used = await countVisitsOn(date);
  const remaining = Math.max(0, MAX_VISITS_PER_DAY - used);
  const { times, wholeDay } = await takenVisitTimes(await getPrimaryContractorId(), date);

  return NextResponse.json({
    ok: true,
    // A day the crew is pouring on has no usable slot, however much room the
    // per-day cap says is left.
    available: remaining > 0 && !wholeDay,
    remaining,
    capacity: MAX_VISITS_PER_DAY,
    taken: times,
    wholeDay,
  });
}
