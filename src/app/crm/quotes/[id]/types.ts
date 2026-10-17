export type SaveState = {
  ok: boolean;
  error?: string;
  sent?: boolean;
  smsDelivered?: boolean;
  // The provider's own reason, so a failure is distinguishable from misconfiguration.
  smsError?: string;
  // So a wrong number is obvious.
  smsTo?: string;
  // Held by quiet hours: neither a failure nor a delivery.
  smsHeldUntil?: string;
  // Refused because the quote is already out and unanswered. Rendered as a status, not an error.
  alreadySent?: boolean;
  // Replaced an unanswered quote, so the confirmation says a correction went out.
  revised?: boolean;
};

export type ScheduleState = { ok: boolean; error?: string; message?: string };

// `time` is null on quotes accepted before times were asked; the cards fall back to a default.
// Shared by ScheduleCard and the crew's JobSchedule so they read preferred days the same way.
export type PreferredSlot = { date: string; time: string | null };

// preferred_times[i] belongs to preferred_dates[i]; an off-by-one books the wrong hour.
export function preferredSlots(
  dates: string[] | null | undefined,
  times: (string | null)[] | null | undefined,
): PreferredSlot[] {
  return (dates ?? []).filter(Boolean).map((date, i) => ({ date, time: times?.[i] ?? null }));
}

// The refusal that matters: no before/after photos.
export type FinishState = { ok: boolean; error?: string; message?: string };

// A change order is a little quote: the failure that matters is the customer's text not arriving.
export type ChangeState = {
  ok: boolean;
  error?: string;
  message?: string;
  sent?: boolean;
  smsError?: string;
  smsHeldUntil?: string;
  smsTo?: string;
  /** Applied, but something alongside it (a payment) didn't save. */
  warning?: string;
};
