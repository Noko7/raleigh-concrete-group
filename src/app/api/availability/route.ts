import { NextResponse } from "next/server";

import { MAX_JOBS_PER_DAY, MAX_VISITS_PER_DAY, countJobsOn, countVisitsOn } from "@/lib/crm/queries";

// Public, token-free availability check used by the customer scheduling UIs.
// type=job  → booked work days (max 1/day)
// type=quote → in-person quote visits (max 5/day)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "quote" ? "quote" : "job";
  const date = (searchParams.get("date") || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Invalid date." }, { status: 400 });
  }

  const capacity = type === "quote" ? MAX_VISITS_PER_DAY : MAX_JOBS_PER_DAY;
  const used = type === "quote" ? await countVisitsOn(date) : await countJobsOn(date);
  const remaining = Math.max(0, capacity - used);

  return NextResponse.json({ ok: true, available: remaining > 0, remaining, capacity });
}
