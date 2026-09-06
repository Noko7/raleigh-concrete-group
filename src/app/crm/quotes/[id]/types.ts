export type SaveState = {
  ok: boolean;
  error?: string;
  sent?: boolean;
  smsDelivered?: boolean;
  // Why the text failed, straight from the provider. Without this a failed send
  // is indistinguishable from a misconfigured one.
  smsError?: string;
  // Where it was sent, so a wrong number is obvious at a glance.
  smsTo?: string;
  // Quiet hours held the text rather than sending it. Not a failure and not a
  // delivery - the banner is its own third thing, because "did NOT go out" is
  // wrong and "sent" is a lie.
  smsHeldUntil?: string;
  // The send was refused because this quote is already with the customer and
  // they haven't answered. Not a failure - the UI renders it as a status rather
  // than an error, because nothing went wrong and nothing needs fixing.
  alreadySent?: boolean;
  // The send replaced a quote the customer already had and hadn't answered, so
  // the confirmation can say a correction went out rather than a first quote.
  revised?: boolean;
};

export type ScheduleState = { ok: boolean; error?: string; message?: string };

// One day the customer said works, and the start time they asked for on it.
// `time` is null on a quote accepted before customers were asked for a time,
// and the scheduling cards fall back to their own default for those.
//
// Shared by the CRM's ScheduleCard and the crew's JobSchedule so the two
// screens can't drift on how a preferred day is read.
export type PreferredSlot = { date: string; time: string | null };

// The two index-aligned columns, zipped into the shape above. Kept here rather
// than in each page because both pages have to agree that preferred_times[i]
// belongs to preferred_dates[i], and an off-by-one would quietly book somebody
// at the wrong hour.
export function preferredSlots(
  dates: string[] | null | undefined,
  times: (string | null)[] | null | undefined,
): PreferredSlot[] {
  return (dates ?? []).filter(Boolean).map((date, i) => ({ date, time: times?.[i] ?? null }));
}

// Closing a job out. Same shape as ScheduleState, named separately because the
// one thing it reports that matters is the refusal: no before/after photos.
export type FinishState = { ok: boolean; error?: string; message?: string };
