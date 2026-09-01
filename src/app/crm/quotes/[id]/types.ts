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
  // The send was refused because this quote is already with the customer and
  // they haven't answered. Not a failure - the UI renders it as a status rather
  // than an error, because nothing went wrong and nothing needs fixing.
  alreadySent?: boolean;
  // The send replaced a quote the customer already had and hadn't answered, so
  // the confirmation can say a correction went out rather than a first quote.
  revised?: boolean;
};

export type ScheduleState = { ok: boolean; error?: string; message?: string };

// Closing a job out. Same shape as ScheduleState, named separately because the
// one thing it reports that matters is the refusal: no before/after photos.
export type FinishState = { ok: boolean; error?: string; message?: string };
