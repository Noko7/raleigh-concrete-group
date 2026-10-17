// Server-only SMS notifications: providers, sending, the held-message queue and recipients. Never import from a client component.
// Re-exported from ../notify.ts, whose header documents the provider settings.
import { clockLabel, hourLabel, inQuietHours, nextSendableAt, now, QUIET_FROM_HOUR, QUIET_UNTIL_HOUR } from "../clock";
import { noEmDash } from "../constants";
import {
  claimMessage,
  finishMessage,
  getOwnerContacts,
  getOwnerPhones,
  listDueMessages,
  logMessage,
  MAX_SEND_ATTEMPTS,
  recentlySent,
  type QuoteMessage,
  type SmsLog,
} from "../queries";

export const SMS_PROVIDER = (process.env.SMS_PROVIDER || (process.env.QUO_API_KEY ? "quo" : "twilio")).toLowerCase();
const OWNER_PHONE = process.env.OWNER_PHONE || "";

export type SendResult = {
  ok: boolean;
  provider: string;
  to?: string;
  // Sending number, so a failure log shows both ends.
  from?: string;
  status?: number;
  detail?: string;
  // Queued (quiet hours), not lost. `ok` stays false since nothing reached the
  // provider; UIs should say "waiting", not "failed".
  held?: boolean;
  // Held by deliberate spacing rather than quiet hours. Same queue; only quiet
  // hours needs explaining to anyone.
  spaced?: boolean;
  // The request was never made (missing key or from-number), so a retry can't
  // duplicate. Unlike a throw, where it may have arrived. Set only before fetch.
  unsent?: boolean;
  // Suppressed: the identical text went to this number seconds ago. `ok` is
  // true because the customer has it; nothing was sent on this call.
  duplicate?: boolean;
  // When it will go out: ISO, and in words ("tomorrow at 8:00 AM").
  sendAfter?: string;
  sendAfterLabel?: string;
};

// Same person? Numbers are compared normalised, since profiles hold whatever
// was typed. Used to skip texting someone about their own action.
export function samePhone(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = toE164(a);
  const y = toE164(b);
  return Boolean(x && y && x === y);
}

export function toE164(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (trimmed.startsWith("+")) {
    const cleaned = "+" + trimmed.slice(1).replace(/\D/g, "");
    return cleaned.length >= 11 && cleaned.length <= 16 ? cleaned : null;
  }
  const d = trimmed.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

async function sendQuo(to: string, message: string): Promise<SendResult> {
  const key = process.env.QUO_API_KEY || "";
  const from = toE164(process.env.QUO_FROM || "") || (process.env.QUO_FROM || "").trim();
  const userId = process.env.QUO_USER_ID || "";
  if (!key) return { ok: false, provider: "quo", unsent: true, detail: "QUO_API_KEY is not set" };
  if (!from) return { ok: false, provider: "quo", unsent: true, detail: "QUO_FROM is not set" };
  // Quo can't text a number from itself and returns an opaque 500, so say why here.
  if (to === from) {
    return {
      ok: false,
      provider: "quo",
      to,
      detail: `That number (${to}) is the same as your sending number, so Quo can't text it. Use a different phone.`,
    };
  }
  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, from, to: [to], ...(userId ? { userId } : {}) }),
  });
  let detail = res.ok ? undefined : await res.text().catch(() => "");
  // Their 500 "Unknown" is useless alone; name the usual causes.
  if (!res.ok && res.status >= 500) {
    detail = `${detail ?? ""}\n\nQuo returned a server error. Usually this means the destination number can't receive texts (landline/VoIP), or your workspace can't message it. Check the number, then try another one in Settings → Text notifications.`;
  }
  return { ok: res.ok, provider: "quo", to, from, status: res.status, detail };
}

async function sendTwilio(to: string, message: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const auth = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";
  if (!sid || !auth || !from)
    return { ok: false, provider: "twilio", unsent: true, detail: "Twilio env vars missing" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  });
  const detail = res.ok ? undefined : await res.text().catch(() => "");
  return { ok: res.ok, provider: "twilio", to, status: res.status, detail };
}

async function sendCustom(to: string, message: string): Promise<SendResult> {
  const url = process.env.SMS_API_URL || "";
  const key = process.env.SMS_API_KEY || "";
  const from = process.env.SMS_FROM || "";
  if (!url) return { ok: false, provider: "custom", unsent: true, detail: "SMS_API_URL is not set" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ to, from, message }),
  });
  const detail = res.ok ? undefined : await res.text().catch(() => "");
  return { ok: res.ok, provider: "custom", to, status: res.status, detail };
}

// Log the attempt. Every exit from sendSmsResult comes here, including ones that
// never reach the provider (e.g. an unparseable number), which look like success
// from outside.
async function record(log: SmsLog | undefined, r: SendResult, to: string, body: string): Promise<void> {
  if (!log) return;
  await logMessage({
    quote_id: log.quoteId ?? null,
    kind: log.kind,
    role: log.role,
    to_phone: to,
    body,
    ok: r.ok,
    provider: r.provider,
    status: r.status ?? null,
    detail: r.detail ?? null,
  });
}

// The provider call with no quiet-hours gate. Only sendSmsResult (daytime) and
// the queue flush may call it.
async function deliver(to: string, message: string): Promise<SendResult> {
  if (SMS_PROVIDER === "quo" || SMS_PROVIDER === "openphone") return sendQuo(to, message);
  if (SMS_PROVIDER === "custom") return sendCustom(to, message);
  return sendTwilio(to, message);
}

/**
 * Send now, or hold until morning.
 *
 * Quiet hours (7pm-8am Eastern) are a courtesy to CUSTOMERS: their texts are
 * written to the log with a `send_after` and delivered by the flush, which
 * every send and both crons run on their way past.
 *
 * Owner and crew texts always go immediately; `role` decides. A send with no
 * log (login text, Settings test) is staff-facing and goes straight out.
 *
 * `force` is only for a customer text answering something they just did (the
 * quote-request receipt, notifyCustomerReceived). Nothing unsolicited.
 */
export async function sendSmsResult(
  toRaw: string,
  messageRaw: string,
  log?: SmsLog,
  // `delayMinutes` parks a text in the same queue, due that many minutes out,
  // so one cron run doesn't fire six texts at one contractor at once (spacer()).
  opts?: { force?: boolean; delayMinutes?: number },
): Promise<SendResult> {
  // Dash guard on every text, including owner-typed content. Applied before
  // logging so the log shows what was sent.
  const message = noEmDash(messageRaw);
  const to = toE164(toRaw);
  if (!to) {
    const bad: SendResult = { ok: false, provider: SMS_PROVIDER, detail: `Invalid phone number: "${toRaw}"` };
    await record(log, bad, toRaw, message);
    return bad;
  }
  if (!message) {
    const empty: SendResult = { ok: false, provider: SMS_PROVIDER, to, detail: "Empty message" };
    await record(log, empty, to, message);
    return empty;
  }

  // Same text seconds ago means a double run; don't tell them twice. Only for
  // job sends: the Settings test (no log) may be fired twice on purpose.
  if (log && (await recentlySent(to, message))) {
    const dupe: SendResult = {
      ok: true,
      duplicate: true,
      provider: SMS_PROVIDER,
      to,
      detail: "Already sent this exact text to this number moments ago, so it was not sent again.",
    };
    console.warn("[sms] suppressed a duplicate", { to, kind: log.kind, quoteId: log.quoteId ?? null });
    return dupe;
  }

  // One queue, two reasons: quiet hours (customers only) and spacing (anyone).
  // The later wins, so spacing can never push a customer text out at 11pm.
  const quietHold = !opts?.force && log?.role === "customer" && inQuietHours();
  const delayMinutes = Math.max(0, Math.trunc(opts?.delayMinutes ?? 0));
  if (quietHold || delayMinutes > 0) {
    const quietDue = quietHold ? nextSendableAt() : null;
    const spacedDue = delayMinutes > 0 ? new Date(now().getTime() + delayMinutes * 60_000) : null;
    const due =
      quietDue && spacedDue ? (spacedDue.getTime() > quietDue.getTime() ? spacedDue : quietDue) : (quietDue ?? spacedDue!);
    const label = clockLabel(due);
    const detail = quietDue
      ? `Quiet hours (${hourLabel(QUIET_FROM_HOUR)} to ${hourLabel(QUIET_UNTIL_HOUR)}). Held, and goes out ${label}.`
      : `Spaced out so this run doesn't send several at once. Goes out ${label}.`;
    const queued = await logMessage({
      quote_id: log?.quoteId ?? null,
      kind: log?.kind ?? "spaced",
      role: log?.role ?? "crew",
      to_phone: to,
      body: message,
      ok: false,
      provider: SMS_PROVIDER,
      detail,
      send_after: due.toISOString(),
    });
    // The row IS the queue entry: a failed insert means the text exists nowhere.
    // Report failure, not "held", which would promise it's coming.
    if (!queued) {
      const lost: SendResult = {
        ok: false,
        provider: SMS_PROVIDER,
        to,
        detail:
          "Could not put this text on the queue, so it has NOT been sent and is not waiting to be. Send it again.",
      };
      console.error("[sms-queue] could not queue a held message", { to, kind: log?.kind ?? "spaced" });
      return lost;
    }
    return {
      ok: false,
      held: true,
      // Spaced, not held by the clock; only quiet hours is worth explaining.
      spaced: !quietDue,
      provider: SMS_PROVIDER,
      to,
      detail,
      sendAfter: due.toISOString(),
      sendAfterLabel: label,
    };
  }

  // The first text of the morning drags the night's queue out with it. Not part
  // of this result: a stuck queue mustn't delay this send.
  await flushInBackground();

  try {
    const r = await deliver(to, message);
    if (!r.ok) {
      console.error("[sms] send failed", {
        provider: r.provider,
        from: r.from,
        to,
        status: r.status,
        detail: r.detail,
      });
    }
    await record(log, r, to, message);
    return r;
  } catch (e) {
    console.error("[sms] threw", e);
    const thrown: SendResult = { ok: false, provider: SMS_PROVIDER, to, detail: String(e) };
    await record(log, thrown, to, message);
    return thrown;
  }
}

export async function sendSms(
  toRaw: string,
  message: string,
  log?: SmsLog,
  opts?: { force?: boolean; delayMinutes?: number },
): Promise<boolean> {
  return (await sendSmsResult(toRaw, message, log, opts)).ok;
}

// ── Spreading a run's texts out ─────────────────────────────────────────────
//
// A cron reaches all its conclusions in one second; six buzzes at once get
// skimmed as one. Each person's texts from one run get slots that become
// `send_after`. The first is never delayed, only the pile behind it.
// REMINDER_SPACING_MINUTES=0 disables it.
export const REMINDER_SPACING_MINUTES = (() => {
  const raw = Number(process.env.REMINDER_SPACING_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 15;
})();

/**
 * Per-phone delay in minutes for one cron run: 0, 15, 30... per person, each
 * person independent. Create once per run and pass it down; a fresh spacer per
 * section would reset everyone to 0.
 */
export function spacer(minutes = REMINDER_SPACING_MINUTES): (phone?: string | null) => number {
  const used = new Map<string, number>();
  return (phone?: string | null) => {
    if (!phone || minutes <= 0) return 0;
    const key = toE164(phone) ?? phone;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    return n * minutes;
  };
}

// ── The morning flush ───────────────────────────────────────────────────────

export type FlushResult = {
  due: number;
  sent: number;
  failed: number;
  skipped?: string;
  // The queue couldn't be read at all. Distinct from `due: 0` (looked, empty),
  // so a stalled queue doesn't report "all clear".
  error?: string;
};

/**
 * Deliver everything held back. Runs on the way past (both daily crons and
 * every daytime send), since serverless has no process to wake at 8am; the
 * 10am cron is the floor. Rows are claimed first (claimMessage), so concurrent
 * flushes still text each person once.
 */
export async function flushHeldMessages(limit = 25, budgetMs = 8000): Promise<FlushResult> {
  // Quiet hours apply to customers only, so checked per row; spaced crew
  // texts go out any hour.
  const quiet = inQuietHours();

  const startedAt = now().getTime();
  let due: QuoteMessage[];
  try {
    due = await listDueMessages(now().toISOString(), limit);
  } catch (e) {
    // Returned, not thrown: crons report it in their response, and a send that
    // flushes on its way past mustn't fail because of it.
    const error = String(e);
    console.error("[sms-queue] could not read the queue", error);
    return { due: 0, sent: 0, failed: 0, error };
  }
  let sent = 0;
  let failed = 0;

  let waiting = 0;
  for (const m of due) {
    if (now().getTime() - startedAt > budgetMs) break;
    if (quiet && m.role === "customer") {
      waiting += 1;
      continue;
    }
    if (!m.to_phone || !m.body) {
      // Terminal, so spend it straight to the cap; retrying an empty row can't help.
      await finishMessage(
        m.id,
        { ok: false, provider: SMS_PROVIDER, detail: "Held with no number or body to send." },
        MAX_SEND_ATTEMPTS,
      );
      continue;
    }
    if (!(await claimMessage(m.id, now().toISOString()))) continue;

    const r = await deliver(m.to_phone, m.body).catch(
      (e) => ({ ok: false, provider: SMS_PROVIDER, detail: String(e) }) as SendResult,
    );
    await finishMessage(
      m.id,
      {
        ok: r.ok,
        provider: r.provider,
        status: r.status ?? null,
        detail: r.ok ? null : (r.detail ?? "Send failed."),
        unsent: r.unsent,
      },
      // A failure releases the claim so the next drain retries, up to the cap.
      m.attempts ?? 0,
    );
    if (r.ok) sent += 1;
    else failed += 1;
  }

  if (failed > 0) console.error("[sms-queue] held messages that failed to send", { due: due.length, sent, failed });
  return {
    due: due.length,
    sent,
    failed,
    ...(waiting > 0 ? { skipped: `${waiting} customer text(s) still waiting on quiet hours` } : {}),
  };
}

/**
 * Send one queued text now, ahead of its hour. Quiet hours are a default a
 * person can override, e.g. correcting a price at 6:30am before the customer
 * approves the wrong one.
 *
 * Built from the drain's claim/deliver/finish, so racing a cron still sends
 * one text.
 */
export async function sendHeldMessageNow(m: QuoteMessage): Promise<SendResult> {
  if (!m.to_phone || !m.body) {
    return { ok: false, provider: SMS_PROVIDER, detail: "There is no number or message on this row to send." };
  }
  if (!(await claimMessage(m.id, now().toISOString()))) {
    return {
      ok: false,
      provider: SMS_PROVIDER,
      to: m.to_phone,
      detail:
        "Could not take this text off the queue, so nothing was sent. " +
        "It has either just gone out, been cancelled, or the queue cannot be written to at all.",
    };
  }

  const r = await deliver(m.to_phone, m.body).catch(
    (e) => ({ ok: false, provider: SMS_PROVIDER, detail: String(e) }) as SendResult,
  );
  // Same bookkeeping as the drain, including requeueing on a provider refusal.
  await finishMessage(
    m.id,
    {
      ok: r.ok,
      provider: r.provider,
      status: r.status ?? null,
      detail: r.ok ? null : (r.detail ?? "Send failed."),
      unsent: r.unsent,
    },
    m.attempts ?? 0,
  );
  if (!r.ok) console.error("[sms-queue] a hand-sent held message failed", { id: m.id, detail: r.detail });
  return r;
}

// Drain without making the caller wait. `after` runs once the response is out,
// the only way serverless can leave work running. Outside a request it throws,
// so fall back to a short, bounded awaited flush.
export async function flushInBackground(): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(() => flushHeldMessages().catch(() => {}));
  } catch {
    await flushHeldMessages(5, 2500).catch(() => {});
  }
}

// Phones to leave out: whoever already knows because they did it (often two:
// the crew member who acted and the office copy they already got).
export type PhoneExclusion = string | null | undefined | (string | null | undefined)[];

// Everyone who gets an owner alert, de-duplicated in E.164. Exported so Settings
// shows exactly who a real alert reaches.
export async function ownerRecipients(excludeRaw?: PhoneExclusion): Promise<string[]> {
  const recipients = new Map<string, string>();
  const add = (raw?: string | null) => {
    const e = raw ? toE164(raw) : null;
    if (e) recipients.set(e, e);
  };

  // Saved owner profiles win outright; OWNER_PHONE is only a bootstrap until
  // someone saves a number, so a stale env var can't keep texting.
  try {
    for (const p of await getOwnerPhones()) add(p);
  } catch {
    // ignore: the env fallback below still applies
  }
  if (recipients.size === 0) add(OWNER_PHONE);

  for (const raw of Array.isArray(excludeRaw) ? excludeRaw : [excludeRaw]) {
    const e = raw ? toE164(raw) : null;
    if (e) recipients.delete(e);
  }
  return [...recipients.values()];
}

// Each number with its source (env var vs editable profile), so an unknown
// recipient can be traced. `active` is false for OWNER_PHONE once any owner
// has a saved number; shown greyed out rather than hidden.
export type OwnerRecipient = { phone: string; source: "env" | "profile"; who: string; active: boolean };

export async function ownerRecipientDetails(): Promise<OwnerRecipient[]> {
  const byPhone = new Map<string, OwnerRecipient>();

  try {
    for (const o of await getOwnerContacts()) {
      const e = toE164(o.phone);
      if (e) byPhone.set(e, { phone: e, source: "profile", who: o.name, active: true });
    }
  } catch {
    // ignore: the env entry below still applies
  }

  const envPhone = OWNER_PHONE ? toE164(OWNER_PHONE) : null;
  if (envPhone && !byPhone.has(envPhone)) {
    byPhone.set(envPhone, {
      phone: envPhone,
      source: "env",
      who: "OWNER_PHONE env var",
      // Only used while no owner profile has a number saved.
      active: byPhone.size === 0,
    });
  }

  return [...byPhone.values()];
}

// Every active owner gets a copy, minus the acting user(s).
export async function alertOwner(
  message: string,
  excludeRaw?: PhoneExclusion,
  log?: Omit<SmsLog, "role">,
): Promise<void> {
  const recipients = await ownerRecipients(excludeRaw);
  if (recipients.length === 0) {
    console.error("[sms] alertOwner: no owner recipients (set OWNER_PHONE or an owner's phone in Settings)");
    // Record the miss: an alert addressed to nobody errors nowhere and arrives nowhere.
    if (log) {
      await logMessage({
        quote_id: log.quoteId ?? null,
        kind: log.kind,
        role: "owner",
        to_phone: null,
        body: message,
        ok: false,
        provider: SMS_PROVIDER,
        detail: "Not sent: no owner phone is configured. Add one in Settings, or set OWNER_PHONE in Vercel.",
      });
    }
    return;
  }
  await Promise.all(
    recipients.map((p) => sendSms(p, message, log ? { ...log, role: "owner" } : undefined).catch(() => {})),
  );
}

// Settings → Notifications. Reports only whether each secret is present, never
// its value.
export type SmsDiagnostics = {
  provider: string;
  from: string | null;
  missing: string[];
  ready: boolean;
};

export function smsDiagnostics(): SmsDiagnostics {
  const missing: string[] = [];
  let from: string | null = null;

  if (SMS_PROVIDER === "quo" || SMS_PROVIDER === "openphone") {
    if (!process.env.QUO_API_KEY) missing.push("QUO_API_KEY");
    from = (process.env.QUO_FROM || "").trim() || null;
    if (!from) missing.push("QUO_FROM");
  } else if (SMS_PROVIDER === "custom") {
    if (!process.env.SMS_API_URL) missing.push("SMS_API_URL");
    from = (process.env.SMS_FROM || "").trim() || null;
  } else {
    if (!process.env.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
    if (!process.env.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
    from = (process.env.TWILIO_FROM || "").trim() || null;
    if (!from) missing.push("TWILIO_FROM");
  }

  return { provider: SMS_PROVIDER, from, missing, ready: missing.length === 0 };
}
