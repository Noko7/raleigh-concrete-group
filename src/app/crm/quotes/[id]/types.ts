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
};

export type ScheduleState = { ok: boolean; error?: string; message?: string };
