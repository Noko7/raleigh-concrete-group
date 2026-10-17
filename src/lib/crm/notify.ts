// Server-only SMS notifications. Never import from a client component.
//
// Provider is chosen with SMS_PROVIDER; if unset we default to "quo" when a
// QUO_API_KEY is present, otherwise "twilio".
//   Quo (OpenPhone):  QUO_API_KEY, QUO_FROM (E.164), optional QUO_USER_ID
//   Twilio:           TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   Custom:           SMS_API_URL, SMS_API_KEY, SMS_FROM  (POSTs { to, from, message })
// OWNER_PHONE receives the owner alerts ("my number").
//
// Every send is best-effort so an SMS outage can't break a submission or save.
// Failures log with an [sms] prefix.
import { phoneDisplay } from "@/lib/site-data";
import { clockLabel, hourLabel, inQuietHours, nextSendableAt, now, QUIET_FROM_HOUR, QUIET_UNTIL_HOUR } from "./clock";
import { firstNameOf, dollars, noEmDash, QUOTE_TTL_DAYS, STALE_LEAD_HOURS, visitDateOf } from "./constants";
import { SITE_ORIGIN } from "./env";
// Ledger money is in cents and must print with them ("$6,172.50", not
// "$6,172.5"), unlike the local dollars-only `usd`.
import { usd as money } from "./fees";
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
} from "./queries";

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

export function jobLink(token: string): string {
  return `${SITE_ORIGIN}/job/${token}`;
}
export function quoteLink(token: string): string {
  return `${SITE_ORIGIN}/q/${token}`;
}
export function confirmLink(token: string): string {
  return `${SITE_ORIGIN}/confirm/${token}`;
}
// The customer's payment page. Same token and link for the life of the job, so
// it can be re-sent any time.
export function payLink(token: string): string {
  return `${SITE_ORIGIN}/pay/${token}`;
}

// Used only in the FIRST text a customer gets. After that the business speaks,
// since anyone may pick up the phone.
const OWNER_NAME = (process.env.OWNER_NAME || "Noah").trim();
// Google review link for the job-complete thank-you; env overrides without a deploy.
const REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || "https://g.page/r/Cf1V-s7AJLEaEAI/review").trim();
const BUSINESS = "Raleigh Concrete Group";

// Opt-out notice: only in the FIRST message to someone; repeating it trains
// people to skip it. STOP works on every message regardless, since the carrier
// and provider handle it before it reaches us.
const OPT_OUT_LINE = "Reply STOP any time to stop these texts.";
// Number the crew call when they can't make it. Defaults to site-data's main
// line, so the digits live in one place.
const CALL_NUMBER = (process.env.OWNER_CALL_NUMBER || phoneDisplay).trim();

// Messages are built from lines, not sentences: the crew read these on site.
// `block("Label:", value)` is the shape throughout: label, value, blank.
function block(label: string, ...values: (string | null | undefined)[]): string[] {
  const clean = values.filter((v): v is string => Boolean(v && v.trim()));
  return clean.length ? [label, ...clean, ""] : [];
}

// Joins lines and collapses blank runs, so an omitted block leaves no gap.
function text(lines: (string | null | undefined)[]): string {
  return lines
    .filter((l): l is string => l !== null && l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type QuoteInfo = {
  // For logging against the job. Optional: a few texts precede a job.
  id?: string | null;
  name: string;
  phone: string;
  service?: string | null;
  address?: string | null;
  details?: string | null;
  quote_type?: string | null;
  quote_amount?: number | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  preferred_dates?: string[] | null;
  // Start time per preferred date, index-aligned. Entries may be null.
  preferred_times?: (string | null)[] | null;
  visit_date?: string | null;
  visit_time?: string | null;
  public_token?: string;
  job_token?: string;
  // What the customer said yes/no to on an itemised quote. Only on texts sent
  // as they answer.
  chosen?: { accepted: ChosenOption[]; declined: ChosenOption[] } | null;
};

export type ChosenOption = { title: string; amount: number };

const firstName = (full: string) => firstNameOf(full, "there");

// Line items with prices for crew/owner texts: "approved" alone doesn't say
// whether the sidewalk is in. Never in customer texts (money); see below.
function chosenBlockPriced(q: QuoteInfo): string[] {
  const c = q.chosen;
  if (!c || c.accepted.length === 0) return [];
  const line = (o: ChosenOption) => `${o.title} - ${usd(o.amount)}`;
  return [
    ...block("Approved:", ...c.accepted.map(line)),
    ...(c.declined.length > 0 ? block("Turned down:", ...c.declined.map((o) => o.title)) : []),
  ];
}
// PRICE NEVER GOES IN A CUSTOMER TEXT. A bare figure has no scope beside it and
// gets forwarded and shopped around; the quote page shows it in context, and
// texts carry the link. `usd` is for "owner" and "crew" roles only.
const usd = (n?: number | null) => dollars(n);

// 1st, 2nd, 3rd, 4th...
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

// "Friday, August 29th", or null when there's no date, so a crew text never
// says "your scheduled day" for an unbooked job.
function dayOrNull(ymd?: string | null): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00`);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${weekday}, ${month} ${ordinal(d.getDate())}`;
}

function prettyDay(ymd?: string | null): string {
  return dayOrNull(ymd) ?? "your scheduled day";
}

// Customer block for crew texts. One field per line rather than label blocks,
// which would push a reminder past four SMS segments. Absent fields are omitted.
function customerBrief(q: QuoteInfo): string {
  const lines = [`Customer: ${q.name}`, `Phone: ${q.phone}`];
  if (q.service?.trim()) lines.push(`Service: ${q.service.trim()}`);
  if (q.address?.trim()) lines.push(`Address: ${q.address.trim()}`);

  const jobDay = dayOrNull(q.scheduled_date);
  const visitDay = dayOrNull(visitDateOf(q));
  if (jobDay) lines.push(`Scheduled: ${jobDay}${q.scheduled_time ? ` at ${q.scheduled_time}` : ""}`);
  else if (visitDay) lines.push(`Quote visit: ${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}`);
  else lines.push("Scheduled: not yet");

  return lines.join("\n");
}

// ── 1. New quote in: text the owner(s) and the auto-assigned contractor ─────
// The owner's version uses labelled blocks so name and number scan at a glance.
export function newQuoteMessage(q: QuoteInfo): string {
  // Free text from the customer; capped so one alert isn't a ten-part text.
  const raw = q.details?.trim();
  const details = raw ? (raw.length > 400 ? `${raw.slice(0, 400)}…` : raw) : null;
  // Raw visit_date, not visitDateOf: an online request's fallback slot is shown
  // too, and the label below says which it is.
  const visitDay = dayOrNull(q.visit_date);

  return text([
    ...block("New Quote Request for:", q.name),
    ...block("Job Type:", q.service?.trim() || "Not specified"),
    ...block("Customer Phone:", q.phone),
    ...block("Address:", q.address?.trim()),
    // Quote type decides the next step: desk work (online) or a drive (in person).
    // Omitted when unset.
    ...block(
      "Quote Type:",
      q.quote_type === "online"
        ? "Online - price it from the photos"
        : q.quote_type === "plans"
          ? "From plans - no visit, price it off the drawings"
          : q.quote_type === "inperson"
            ? "In person"
            : null,
    ),
    // On an online request the date is only the customer's fallback slot, and
    // the label must say nobody agreed to it, or the crew drive out on a maybe.
    // Plans jobs have no date, so the block drops out.
    ...block(
      q.quote_type === "online" ? "If a visit is needed, they asked for:" : "Visit Booked:",
      q.quote_type === "plans"
        ? null
        : visitDay
          ? `${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}${
              q.quote_type === "online" ? " (not confirmed - confirm it on the job page)" : ""
            }`
          : // In person with no time (skipped, or it had passed): the lead was
            // saved anyway, so the next step is the reader's.
            q.quote_type === "inperson"
            ? "Not booked yet - call or text them to set a time"
            : null,
    ),
    ...block("Details:", details),
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

export async function notifyNewQuote(
  q: QuoteInfo,
  contractorPhone?: string | null,
  contractorName?: string | null,
): Promise<void> {
  await alertOwner(newQuoteMessage(q), null, { quoteId: q.id, kind: "new_quote" });
  if (contractorPhone) {
    // Same brief as a manual assignment: to the crew it's the same event.
    await sendSms(contractorPhone, assignmentMessage(q, contractorName), {
      quoteId: q.id,
      kind: "new_quote_crew",
      role: "crew",
    }).catch(() => {});
  }
}

// ── 3. Acknowledge the customer the moment their request lands ──────────────
export async function notifyCustomerReceived(q: QuoteInfo): Promise<void> {
  const msg =
    q.quote_type === "inperson" && !dayOrNull(q.visit_date)
      ? // In person with no time: the request was saved anyway. Promise a
        // call, not a booking.
        text([
          `Hi ${firstName(q.name)},`,
          `this is ${OWNER_NAME} with ${BUSINESS}. We got your request for a free in-person quote.`,
          "",
          "We'll call or text you shortly to set a time that works for you.",
          "",
          OPT_OUT_LINE,
        ])
      : q.quote_type === "inperson"
      ? text([
          `Hi ${firstName(q.name)},`,
          `this is ${OWNER_NAME} with ${BUSINESS}. You're set for your free in-person quote:`,
          "",
          `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`,
          "",
          "We look forward to meeting you. Reply or call if anything changes.",
          "",
          OPT_OUT_LINE,
        ])
      : // Promises a follow-up, not a price or timeframe, which the job may not
        // meet. Their slot is echoed back as explicitly unconfirmed so they
        // don't put us in their calendar.
        text([
          `Hi ${firstName(q.name)},`,
          `this is ${OWNER_NAME} with ${BUSINESS}. Thanks for reaching out.`,
          "",
          "We got your request and we're looking over the details now. We'll follow up soon with next steps, and reach out if we need anything else about the project.",
          ...(dayOrNull(q.visit_date)
            ? [
                "",
                "If it turns out we need to see it in person, you asked for:",
                `${dayOrNull(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`,
                "",
                "Nothing is booked yet - we'll text you to confirm before anyone comes out.",
              ]
            : []),
          "",
          OPT_OUT_LINE,
        ]);
  // Forced through quiet hours: it's a receipt for a form submitted seconds ago.
  // Holding it reads as the form failing (resubmits, calls to competitors).
  // The office alert for the same lead does wait.
  await sendSms(q.phone, msg, { quoteId: q.id, kind: "received", role: "customer" }, { force: true }).catch(() => {});
}

// ── 4. Contractor confirms the visit an online customer offered ─────────────
// A maybe becomes an appointment. Both sides get the same day/time shape.
export async function notifyVisitConfirmed(
  q: QuoteInfo,
  crewPhone?: string | null,
  crewName?: string | null,
  requested?: { date?: string | null; time?: string | null },
  fromOnline = true,
  // Who confirmed it; skip texting them about their own action.
  actorPhone?: string | null,
): Promise<void> {
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;

  // A photo-quote customer getting a visit needs the reason first (measuring),
  // or it reads as a sales call. The day is offered, not announced: their slot
  // was a maybe, possibly weeks old. If the crew moved it, name only the part
  // that changed.
  const movedDay = Boolean(requested?.date) && requested?.date !== q.visit_date;
  const movedTime = !movedDay && Boolean(requested?.time) && requested?.time !== q.visit_time;
  const wasAsked = movedDay ? prettyDay(requested?.date) : movedTime ? requested?.time : null;
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}.`,
      "",
      // The photos line only makes sense to someone who sent photos.
      fromOnline
        ? "For a job like this we want to make sure you get an accurate estimate, so rather than price it off the photos we'd like to come measure it in person. We have you down for:"
        : "To make sure you get an accurate estimate we'd like to come measure the job in person. We have you down for:",
      "",
      when,
      "",
      q.address?.trim() || null,
      "",
      wasAsked ? `That's a change from the ${wasAsked} you asked about - it's the closest slot we have open.` : null,
      "",
      `It's still free and there's no obligation. Reply to this text or call us at ${phoneDisplay} if another day or time works better for you.`,
    ]),
    { quoteId: q.id, kind: "visit_confirmed", role: "customer" },
  ).catch(() => {});

  if (crewPhone && !samePhone(crewPhone, actorPhone)) {
    await sendSms(
      crewPhone,
      text([
        "QUOTE VISIT CONFIRMED",
        "",
        ...block("When:", when),
        customerBrief(q),
        "",
        `Can't make it? Call ${CALL_NUMBER} as soon as you know.`,
        "",
        q.job_token ? jobLink(q.job_token) : null,
      ]),
      { quoteId: q.id, kind: "visit_confirmed", role: "crew" },
    ).catch(() => {});
  }

  await alertOwner(
    text([
      "QUOTE VISIT CONFIRMED",
      "",
      ...block("When:", when),
      ...block("Confirmed by:", crewName || "crew"),
      customerBrief(q),
    ]),
    [actorPhone, crewPhone],
    { quoteId: q.id, kind: "visit_confirmed" },
  ).catch(() => {});
}

// ── 4a. A message the owner wrote themselves ────────────────────────────────
// Sent when logging a call-in lead; the body is whatever the owner typed.
// Business name and STOP notice are always added: this is the first text the
// lead has had from us.
export async function notifyCustomMessage(q: QuoteInfo, body: string): Promise<SendResult> {
  const written = body.trim();
  return sendSmsResult(
    q.phone,
    text([written, "", BUSINESS, "", OPT_OUT_LINE]),
    { quoteId: q.id, kind: "custom", role: "customer" },
  );
}

// ── 4b. Estimate booked on a phone call ─────────────────────────────────────
// Booked while the customer is on the line, so it's a short written confirmation.
export async function notifyVisitBooked(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${OWNER_NAME} with ${BUSINESS}, confirming your free estimate:`,
      "",
      `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`,
      "",
      q.address?.trim() || null,
      "",
      `Call or text ${phoneDisplay} if you need to change it.`,
      "",
      OPT_OUT_LINE,
    ]),
    { quoteId: q.id, kind: "visit_booked", role: "customer" },
  ).catch(() => {});
}

// ── 5. Quote is ready: send the customer their link ─────────────────────────
// Link and deadline, never the price (see `usd`). The deadline is stated so the
// quote doesn't quietly stop working.
export async function notifyQuoteReady(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `our team reviewed your project and your quote is ready.`,
      "",
      "View it here:",
      quoteLink(q.public_token ?? ""),
      "",
      `This quote is good for ${QUOTE_TTL_DAYS} days.`,
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "quote_ready", role: "customer" },
  );
}

// ── 5a. The quote changed after it went out ─────────────────────────────────
// A price that was wrong is worth a second interruption, and the text says the
// earlier number no longer stands. Same link (the page renders the current
// row), and it says so, since "updated" makes people doubt the old link.
export async function notifyQuoteUpdated(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "we've updated the quote we sent you, so please use this one rather than the earlier version.",
      "",
      "View the updated quote here:",
      quoteLink(q.public_token ?? ""),
      "",
      `The link is the same one we sent before. This updated quote is good for ${QUOTE_TTL_DAYS} days.`,
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "quote_updated", role: "customer" },
  );
}

// ── 5a-ii. Another way of doing the job was added ───────────────────────────
// Its own message: this isn't a correction. The price was right but too high
// for them, and a second way to do the job now sits beside it. Same link, no
// price: the two figures only mean something side by side.
export async function notifyQuoteOptionAdded(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "we've added another option to your quote so you can compare both and pick the one you'd like.",
      "",
      "See both options here:",
      quoteLink(q.public_token ?? ""),
      "",
      `It's the same link we sent before. This quote is good for ${QUOTE_TTL_DAYS} days.`,
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "quote_option_added", role: "customer" },
  );
}

// ── 5b. Quote is out: tell the office ──────────────────────────────────────
// A quote going out is a money moment; the owner is told. Not whoever pressed
// Send: their screen already reports it, and nobody is told about their own
// click. Keyed on whether the customer's text was accepted: "quote sent" over a
// bounced text makes everyone stop chasing a customer who never heard from us.
export async function notifyQuoteSent(
  q: QuoteInfo,
  sender: { name?: string | null; phone?: string | null },
  // The customer send's outcome: reached the provider, held for quiet hours, or
  // failed. Held is not failed: telling someone at 9pm their quote "did NOT go
  // out" leads to resends or false alarms.
  outcome: { ok: boolean; held?: boolean; sendAfterLabel?: string },
  // A correction to an already-sent quote: the office needs to know the number moved.
  revised = false,
): Promise<void> {
  const by = sender.name?.trim() || "A contractor";
  const delivered = outcome.ok;
  // Only customer sends are ever held; crew copies go out immediately.
  const held = !delivered && Boolean(outcome.held);
  const when = outcome.sendAfterLabel ?? "in the morning";

  await alertOwner(
    delivered
      ? text([
          revised ? "QUOTE UPDATED" : "QUOTE SENT",
          "",
          ...block("Sent by:", by),
          ...block("Customer:", q.name),
          ...block(revised ? "New amount:" : "Amount:", usd(q.quote_amount)),
          revised
            ? "This replaces the quote they were already sent. Waiting on them to approve or decline."
            : "Waiting on them to approve or decline.",
        ])
      : held
        ? text([
            revised ? "QUOTE UPDATED, QUEUED" : "QUOTE SENT, QUEUED",
            "",
            ...block("Sent by:", by),
            ...block("Customer:", q.name),
            ...block(revised ? "New amount:" : "Amount:", usd(q.quote_amount)),
            `We don't text customers between 7pm and 8am, so theirs goes out ${when}.`,
            "Nothing to do. The quote link is already live if it can't wait.",
          ])
        : text([
            "QUOTE TEXT FAILED",
            "",
            ...block("Tried by:", by),
            ...block("Customer:", q.name),
            ...block("Their number:", q.phone),
            "The quote link did NOT reach them. Give them a call.",
          ]),
    // Don't tell whoever pressed the button what they just did.
    sender.phone,
    { quoteId: q.id, kind: "quote_sent" },
  ).catch(() => {});
}

// ── 6. Customer approved: thank them, but don't promise a day yet ───────────
// They proposed dates; the crew confirms one. "We'll confirm" stops them
// assuming their first choice is locked in.
export async function notifyCustomerApproved(
  q: QuoteInfo,
  // Deposit to ask for, in cents, when this job's crew takes cards. Null on a
  // cash-only job: an unpayable link is worse than none.
  depositCents?: number | null,
): Promise<void> {
  const asking = Boolean(depositCents && depositCents > 0 && q.public_token);
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "thanks for approving your quote.",
      "",
      // Titles only, never prices (as in every customer text): a receipt for
      // what they chose.
      q.chosen && q.chosen.accepted.length > 0
        ? `We've got you down for: ${q.chosen.accepted.map((o) => o.title).join(", ")}.`
        : null,
      q.chosen && q.chosen.accepted.length > 0 ? "" : null,
      "We're checking the crew's schedule against the days you picked and will text you shortly to confirm your project date and time.",
      // The deposit rides on this message rather than a second text. Last, and
      // an offer, not an instruction: paying the crew in cash is fine.
      ...(asking
        ? [
            "",
            `Your deposit is ${money(depositCents as number)}, and paying it locks your date in:`,
            payLink(q.public_token as string),
            "",
            "Prefer cash, check, Zelle or Venmo? Just settle up with the crew on the day.",
          ]
        : []),
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "approved", role: "customer" },
  ).catch(() => {});
}

// ── 6b. Approved: tell the owner + crew it needs a date ─────────────────────
export async function notifyNeedsScheduling(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  // Day AND hour: bare days send the crew back to ask what time, the call the
  // propose-and-confirm flow exists to avoid.
  const times = q.preferred_times ?? [];
  const picks = (q.preferred_dates ?? [])
    .map((d, i) => {
      const day = dayOrNull(d);
      return day ? `${day}${times[i] ? ` at ${times[i]}` : ""}` : null;
    })
    .filter((d): d is string => Boolean(d));
  const wanted = picks.length ? block("Customer prefers:", ...picks) : block("Customer prefers:", "No days given");

  await alertOwner(
    text([
      "QUOTE APPROVED",
      "",
      ...block("Customer:", q.name),
      ...block("Amount:", usd(q.quote_amount)),
      ...chosenBlockPriced(q),
      ...wanted,
      "Needs a confirmed date and time.",
      "",
      q.job_token ? jobLink(q.job_token) : null,
    ]),
    null,
    { quoteId: q.id, kind: "needs_scheduling" },
  );

  if (contractorPhone) {
    await sendSms(
      contractorPhone,
      text([
        `${q.name} approved their quote. We need a date confirmed.`,
        "",
        customerBrief(q),
        "",
        ...chosenBlockPriced(q),
        ...wanted,
        "Confirm the day that works:",
        jobLink(q.job_token ?? ""),
        "",
        "Sign in with your CRM login to pick it.",
      ]),
      { quoteId: q.id, kind: "needs_scheduling", role: "crew" },
    ).catch(() => {});
  }
}


// ── 6c. Approved on the phone: say who wrote it down ────────────────────────
// Same news as notifyNeedsScheduling, but the key fact isn't in the database:
// nobody watched the customer press a button; a staff member recorded a yes,
// and the alert names them. Sent even when the day is booked too, because
// JOB BOOKED alone reads like the customer clicked.
export async function notifyOfflineApproval(
  q: QuoteInfo,
  contractorPhone: string | null | undefined,
  opts: {
    // Recorder's name for the alert; their phone so they aren't texted about it.
    recordedBy: string;
    actorPhone?: string | null;
    // Day booked in the same form: q carries the booked date. Otherwise any
    // day from the call is only a preference.
    booked?: boolean;
  },
): Promise<void> {
  const agreed = dayOrNull(q.preferred_dates?.[0]);
  const time = q.preferred_times?.[0] ?? null;
  const when = opts.booked
    ? block("Booked for:", dayAndTime(q))
    : agreed
      ? block("Agreed on the call:", `${agreed}${time ? ` at ${time}` : ""}`, "Still needs confirming.")
      : block("No day agreed yet:", "Needs a date and time.");

  const msg = text([
    "APPROVED BY PHONE",
    "",
    ...block("Customer:", q.name),
    ...block("Amount:", usd(q.quote_amount)),
    ...chosenBlockPriced(q),
    ...when,
    `Recorded by ${opts.recordedBy}, not by the customer's own link.`,
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);

  await alertOwner(msg, opts.actorPhone, { quoteId: q.id, kind: "approved_offline" });
  // Crew copy only if someone else recorded it; otherwise their screen is the receipt.
  if (contractorPhone && !samePhone(contractorPhone, opts.actorPhone)) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "approved_offline", role: "crew" }).catch(() => {});
  }
}

// ── 6d. Approved on the phone: the customer's written record ────────────────
// Only when the call ended without a day. With one, the confirmed text carries
// both, and they don't need two texts about one call.
export async function notifyApprovalRecorded(q: QuoteInfo): Promise<void> {
  const agreed = dayOrNull(q.preferred_dates?.[0]);
  const time = q.preferred_times?.[0] ?? null;

  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "thanks for approving your quote over the phone.",
      "",
      // Titles only, never prices.
      q.chosen && q.chosen.accepted.length > 0
        ? `We've got you down for: ${q.chosen.accepted.map((o) => o.title).join(", ")}.`
        : null,
      q.chosen && q.chosen.accepted.length > 0 ? "" : null,
      agreed
        ? `We have you pencilled in for ${agreed}${time ? ` at ${time}` : ""} and will text you shortly to confirm it.`
        : "We're checking the crew's schedule and will text you shortly to confirm your project date and time.",
      "",
      "If any of that isn't what we agreed, just give us a call.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "approved_offline", role: "customer" },
  ).catch(() => {});
}

// "Monday, August 17 at 9:00 AM". Every customer mention of the appointment
// uses this, so the time can't drop out of one message only.
function dayAndTime(q: QuoteInfo): string {
  return `${prettyDay(q.scheduled_date)}${q.scheduled_time ? ` at ${q.scheduled_time}` : ""}`;
}

// ── 7. Date confirmed by the crew: now we can promise the customer a day ────
export async function notifyCustomerScheduled(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `your project with ${BUSINESS} is confirmed for:`,
      "",
      dayAndTime(q),
      "",
      "We look forward to it! We'll text you a reminder before we arrive.",
    ]),
    { quoteId: q.id, kind: "scheduled", role: "customer" },
  ).catch(() => {});
}


// ── 7b. Change orders ───────────────────────────────────────────────────────
// Out to the customer, then their answer to the office and crew.

/**
 * The customer's copy: what is changing and where to answer. No figures, least
 * of all here: a price change without scope beside it starts arguments. Totals,
 * paid and remaining are on the quote page next to the work description.
 * It does say their date hasn't moved and nothing happens unless they say yes,
 * the two things they're actually worried about.
 */
export async function notifyChangeRequested(q: QuoteInfo, note: string): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "here's the change you asked about, ready for you to look over:",
      "",
      note,
      "",
      q.scheduled_date ? `Your date doesn't move: ${dayAndTime(q)}.` : null,
      q.scheduled_date ? "" : null,
      // The page shows the new total against what's been paid (deposit included).
      "See what it changes and approve it here:",
      quoteLink(q.public_token ?? ""),
      "",
      "Nothing changes until you approve it. Questions, just call.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "change_requested", role: "customer" },
  );
}

/** Their answer, to the office and the crew. */
export async function notifyChangeAnswered(
  q: QuoteInfo,
  accepted: boolean,
  change: { note: string; fromCents: number; toCents: number; paidCents: number; depositCents?: number | null },
  contractorPhone?: string | null,
): Promise<void> {
  const diff = change.toCents - change.fromCents;
  const dueCents = Math.max(0, change.toCents - change.paidCents);

  const msg = text([
    accepted ? "CHANGE APPROVED" : "CHANGE TURNED DOWN",
    "",
    ...block("Customer:", q.name),
    ...block("They asked for:", change.note),
    ...(accepted
      ? [
          ...block(
            "New total:",
            `${money(change.toCents)} (was ${money(change.fromCents)}, ${diff > 0 ? "+" : "-"}${money(Math.abs(diff))})`,
          ),
          // Spelled out because "still to collect" on a part-paid job is easily
          // misread as the total. Omitted when nothing's been paid.
          ...(change.paidCents > 0 ? block("Already collected:", money(change.paidCents)) : []),
          ...block("Still to collect:", money(dueCents)),
          // The part of "still to collect" due before the work, if the change asked for one.
          ...(change.depositCents && change.depositCents > 0
            ? block(
                "Deposit due now:",
                `${money(Math.min(change.depositCents, dueCents))}, rest when the work is done`,
              )
            : []),
        ]
      : block("Price unchanged:", money(change.fromCents))),
    // A change order never moves the day; saying so saves the crew checking.
    q.scheduled_date ? `Day is unchanged: ${dayAndTime(q)}.` : null,
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);

  await alertOwner(msg, null, { quoteId: q.id, kind: accepted ? "change_accepted" : "change_declined" });
  if (contractorPhone) {
    await sendSms(contractorPhone, msg, {
      quoteId: q.id,
      kind: accepted ? "change_accepted" : "change_declined",
      role: "crew",
    }).catch(() => {});
  }
}

// Says the date moved rather than re-sending "booked", which reads as a mistake.
// Old and new each get a line so a skimming customer lands on the right day.
export async function notifyCustomerRescheduled(
  q: QuoteInfo,
  previous?: string | null,
  previousTime?: string | null,
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;

  // No previous date: state the new one rather than a dangling "from:".
  const body = was
    ? [`your project with ${BUSINESS} has been moved from:`, "", was, "to:", dayAndTime(q)]
    : [`your project with ${BUSINESS} has been moved to:`, "", dayAndTime(q)];

  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      ...body,
      "",
      "Sorry for the change, call or text us if that day doesn't work.",
    ]),
    { quoteId: q.id, kind: "rescheduled", role: "customer" },
  ).catch(() => {});
}

// ── Quote visits: moved or cancelled from the calendar ─────────────────────
// The customer set time aside, so these get the same courtesy as a booked job.
/**
 * A quote visit moved to a different day. Not the confirmation text again:
 * resending the intro reads as a second appointment. This says only what changed.
 *
 * `crew` is passed when the move came from somewhere other than the crew's own
 * job page, so the person driving there is told.
 */
export async function notifyVisitMoved(
  q: QuoteInfo,
  previous?: string | null,
  previousTime?: string | null,
  crew?: {
    crewPhone?: string | null;
    crewName?: string | null;
    movedBy?: string | null;
    // Who moved it; not texted about their own change.
    actorPhone?: string | null;
    // False when the office already told the customer. Crew and office still hear.
    tellCustomer?: boolean;
  },
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;
  const now = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;

  const body = was
    ? [`your free quote visit with ${BUSINESS} has been moved from:`, "", was, "to:", now]
    : [`your free quote visit with ${BUSINESS} has been moved to:`, "", now];

  if (crew?.tellCustomer !== false) {
    await sendSms(
      q.phone,
      text([`Hi ${firstName(q.name)},`, ...body, "", "Sorry for the change, call or text us if that time doesn't work."]),
      { quoteId: q.id, kind: "visit_moved", role: "customer" },
    ).catch(() => {});
  }

  if (!crew) return;

  const internal = text([
    "QUOTE VISIT MOVED",
    "",
    ...block("Was:", was),
    ...block("Now:", now),
    ...block("Moved by:", crew.movedBy),
    customerBrief(q),
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);

  if (crew.crewPhone && !samePhone(crew.crewPhone, crew.actorPhone)) {
    await sendSms(crew.crewPhone, internal, { quoteId: q.id, kind: "visit_moved", role: "crew" }).catch(() => {});
  }
  await alertOwner(internal, [crew.actorPhone, crew.crewPhone], { quoteId: q.id, kind: "visit_moved" }).catch(() => {});
}

/**
 * A quote visit called off. `asked` = the CUSTOMER asked: theirs gets a
 * receipt, ours an apology; an apology to someone who just cancelled reads as
 * a second cancellation. `crew` is passed when the driver isn't the canceller.
 */
export async function notifyVisitCancelled(
  q: QuoteInfo,
  opts?: CancelAudience,
): Promise<void> {
  const day = dayOrNull(q.visit_date);

  // Skipped when the office already told them on the phone.
  if (opts?.tellCustomer !== false) {
    await sendSms(
      q.phone,
      text(
        opts?.asked
          ? [
              `Hi ${firstName(q.name)},`,
              `that's done - your quote visit with ${BUSINESS}${day ? ` on ${day}` : ""} is cancelled.`,
              "",
              "No problem at all. Call or text us whenever you'd like to book it back in.",
            ]
          : [
              `Hi ${firstName(q.name)},`,
              `we've had to cancel your quote visit with ${BUSINESS}${day ? ` on ${day}` : ""}.`,
              "",
              "We're sorry for the trouble. Call or text us and we'll get you booked back in.",
            ],
      ),
      { quoteId: q.id, kind: "visit_cancelled", role: "customer" },
    ).catch(() => {});
  }

  await tellTeamCancelled(q, "QUOTE VISIT CANCELLED", day, opts);
}

// Who hears about a cancellation, and who already knows because they called it.
export type CancelAudience = {
  asked?: boolean;
  tellCustomer?: boolean;
  crewPhone?: string | null;
  cancelledBy?: string | null;
  actorPhone?: string | null;
};

// Crew and office get the same message: what's off, for whom, and who called it.
// Sent from every cancel path.
async function tellTeamCancelled(
  q: QuoteInfo,
  headline: string,
  was: string | null,
  opts?: CancelAudience,
): Promise<void> {
  if (!opts) return;
  const internal = text([
    headline,
    "",
    ...block("Was:", was),
    ...block("Cancelled by:", opts.asked ? `${q.name} (the customer)` : opts.cancelledBy || "the office"),
    customerBrief(q),
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
  if (opts.crewPhone && !samePhone(opts.crewPhone, opts.actorPhone)) {
    await sendSms(opts.crewPhone, internal, { quoteId: q.id, kind: "cancelled_crew", role: "crew" }).catch(() => {});
  }
  await alertOwner(internal, [opts.actorPhone, opts.crewPhone], { quoteId: q.id, kind: "cancelled_crew" }).catch(() => {});
}

// A booked work day was removed. The customer expects a crew, so never silent.
export async function notifyBookingCancelled(
  q: QuoteInfo,
  previous?: string | null,
  previousTime?: string | null,
  opts?: CancelAudience,
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;

  if (opts?.tellCustomer !== false) {
    await sendSms(
      q.phone,
      text(
        opts?.asked
          ? [
              `Hi ${firstName(q.name)},`,
              `that's done - your project date with ${BUSINESS} is released${was ? ":" : "."}`,
              ...(was ? ["", was] : []),
              "",
              "Your project is still on our books. Call or text us whenever you're ready to pick a new day.",
            ]
          : [
              `Hi ${firstName(q.name)},`,
              `we've had to release your project date with ${BUSINESS}${was ? ":" : "."}`,
              ...(was ? ["", was] : []),
              "",
              "Your project is still on. We're working out a new date and will text you as soon as we have one.",
              "",
              "Sorry for the change, call or text us any time.",
            ],
      ),
      { quoteId: q.id, kind: "booking_cancelled", role: "customer" },
    ).catch(() => {});
  }

  await tellTeamCancelled(q, "WORK DAY RELEASED", was, opts);
}

export async function notifyBooked(
  q: QuoteInfo,
  contractorPhone?: string | null,
  previous?: string | null,
  previousTime?: string | null,
  // Who confirmed the day, usually the assigned contractor on their own job
  // page; they (or an owner in the CRM) shouldn't be texted their own action.
  actorPhone?: string | null,
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;

  const msg = text([
    was ? "DATE CHANGED" : "JOB BOOKED",
    "",
    ...(was ? [...block("From:", was), ...block("To:", dayAndTime(q))] : block("When:", dayAndTime(q))),
    ...block("Amount:", usd(q.quote_amount)),
    customerBrief(q),
    "",
    jobLink(q.job_token ?? ""),
  ]);

  await alertOwner(msg, actorPhone, { quoteId: q.id, kind: "booked" });
  // Crew copy only if someone else booked it; otherwise their page shows it.
  if (contractorPhone && !samePhone(contractorPhone, actorPhone)) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "booked", role: "crew" }).catch(() => {});
  }
}

// ── 6. Customer declined ────────────────────────────────────────────────────
export async function notifyDeclined(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = text([
    "QUOTE DECLINED",
    "",
    ...block("Customer:", q.name),
    ...block("Phone:", q.phone),
    ...block("Amount:", usd(q.quote_amount)),
  ]);
  await alertOwner(msg, null, { quoteId: q.id, kind: "declined" });
  if (contractorPhone) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "declined", role: "crew" }).catch(() => {});
  }
}

// ── 9. Two days out: ask the customer to confirm ────────────────────────────
export async function notifyReminder(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}. Your project is coming up:`,
      "",
      dayAndTime(q),
      "",
      "Please confirm it here:",
      confirmLink(q.public_token ?? ""),
    ]),
    { quoteId: q.id, kind: "reminder", role: "customer" },
  );
}
export async function notifyUnconfirmed(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = text([
    "CUSTOMER COULD NOT CONFIRM",
    "",
    ...block("Customer:", q.name),
    ...block("Phone:", q.phone),
    ...block("Was booked for:", dayAndTime(q)),
    "Please reach out to reschedule.",
  ]);
  await alertOwner(msg, null, { quoteId: q.id, kind: "unconfirmed" });
  if (contractorPhone) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "unconfirmed", role: "crew" }).catch(() => {});
  }
}

// ── 10. Crew reminders ahead of a booked job ────────────────────────────────
// 3 days out, 1 day out and the morning of. Each repeats address, start time and
// who to call, so a no-show is flagged while there's still time to cover it.
export function crewReminderMessage(q: QuoteInfo, daysOut: number, contractorName?: string | null): string {
  const when = daysOut === 0 ? "TODAY" : daysOut === 1 ? "TOMORROW" : `IN ${daysOut} DAYS`;
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";

  return text([
    `JOB REMINDER: ${when}`,
    "",
    greeting,
    "you're scheduled for this job:",
    "",
    ...block("When:", dayAndTime(q)),
    customerBrief(q),
    "",
    `If you can't make it, or anything about the schedule changes, call us right away at ${CALL_NUMBER}.`,
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

export async function notifyCrewReminder(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  daysOut: number,
  contractorName?: string | null,
  // Minutes to hold this back so several jobs don't arrive at once. 0 sends now.
  delayMinutes = 0,
): Promise<SendResult | null> {
  if (!contractorPhone) return null;
  return sendSmsResult(
    contractorPhone,
    crewReminderMessage(q, daysOut, contractorName),
    {
      quoteId: q.id,
      kind: `crew_reminder_${daysOut}`,
      role: "crew",
    },
    { delayMinutes },
  ).catch(() => null);
}

// ── 12. Stale lead: still nothing sent 48h after it came in ────────────────
// Never sent while a visit is still ahead (hasUpcomingVisit), so a visit date
// here has passed: somebody went out and no price came back.
export function staleLeadMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  const visited = dayOrNull(visitDateOf(q));
  return text([
    "LEAD NEEDS ATTENTION",
    "",
    greeting,
    visited
      ? `you visited this job on ${visited} and no quote has gone out yet:`
      : `this lead came in over ${STALE_LEAD_HOURS} hours ago and no quote has gone out yet:`,
    "",
    customerBrief(q),
    "",
    visited
      ? "Send them their price, or call them if something has changed."
      : "Send them a quote, or book a visit if you need to see it first.",
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

// Leads a digest lists before pointing at the CRM.
const DIGEST_MAX_ITEMS = 6;

// One lead as a few lines in a digest. `who` only on the owner's copy.
function staleLeadItem(q: QuoteInfo, n: number, who?: string | null): string {
  const visited = dayOrNull(visitDateOf(q));
  return text([
    `${n}. ${q.name}${q.service?.trim() ? ` - ${q.service.trim()}` : ""}`,
    q.phone,
    q.address?.trim() || null,
    visited ? `Visited ${visited}, no price sent` : null,
    who ? `Assigned: ${who}` : null,
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

/**
 * Every stale lead in one text: less noise than one per lead, and it shows how
 * far behind the pipeline is. `who` labels entries for the owner's copy.
 */
export function staleLeadDigest(
  leads: { quote: QuoteInfo; who?: string | null }[],
  contractorName?: string | null,
): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  const shown = leads.slice(0, DIGEST_MAX_ITEMS);
  const rest = leads.length - shown.length;

  return text([
    `${leads.length} LEADS NEED ATTENTION`,
    "",
    greeting,
    `these came in over ${STALE_LEAD_HOURS} hours ago and no quote has gone out yet:`,
    "",
    ...shown.flatMap((l, i) => [staleLeadItem(l.quote, i + 1, l.who), ""]),
    rest > 0 ? `...and ${rest} more. Open the CRM to see all ${leads.length}.` : null,
    rest > 0 ? "" : null,
    "Send each a quote, or book a visit if you need to see it first.",
  ]);
}

// A contractor's quiet leads. `phone` is null for no number on file and for the
// unassigned pile; both still go in the owner's copy.
export type StaleLeadGroup = {
  phone?: string | null;
  name?: string | null;
  leads: QuoteInfo[];
  // From the caller's spacer, so this queues behind the run's job reminders.
  delayMinutes?: number;
};

/**
 * Each contractor gets their own stale leads, the owner everybody's (including
 * unassigned), one text per person per run. A contractor who is also an owner
 * is skipped: the owner digest already lists their jobs.
 */
export async function notifyStaleLeads(
  groups: StaleLeadGroup[],
): Promise<{ owner: boolean; contractors: number; leads: number }> {
  const withLeads = groups.filter((g) => g.leads.length > 0);
  const leadCount = withLeads.reduce((n, g) => n + g.leads.length, 0);
  if (leadCount === 0) return { owner: false, contractors: 0, leads: 0 };

  // A single lead gets the fuller single-lead message; the digest is for pile-ups.
  const only = leadCount === 1 ? withLeads[0] : null;

  await alertOwner(
    only
      ? staleLeadMessage(only.leads[0], only.name)
      : staleLeadDigest(withLeads.flatMap((g) => g.leads.map((quote) => ({ quote, who: g.name || "Unassigned" })))),
    null,
    // A digest has no single job; each lead's trace is its stale_lead_reminded event.
    only ? { quoteId: only.leads[0].id, kind: "stale_lead" } : { kind: "stale_lead_digest" },
  );

  const owners = new Set(await ownerRecipients());
  let contractors = 0;
  for (const g of withLeads) {
    const phone = g.phone ? toE164(g.phone) : null;
    if (!phone || owners.has(phone)) continue;
    const msg =
      g.leads.length === 1
        ? staleLeadMessage(g.leads[0], g.name)
        : staleLeadDigest(
            g.leads.map((quote) => ({ quote })),
            g.name,
          );
    const log =
      g.leads.length === 1
        ? { quoteId: g.leads[0].id, kind: "stale_lead", role: "crew" as const }
        : { kind: "stale_lead_digest", role: "crew" as const };
    // A queued text counts as handled; the queue row records what happens next.
    if (await sendSms(phone, msg, log, { delayMinutes: g.delayMinutes ?? 0 }).catch(() => false)) contractors += 1;
  }

  return { owner: true, contractors, leads: leadCount };
}

// ── 13. Quote visit, night before: customer + contractor ───────────────────
// notifyReminder covers booked work days; visits get one reminder, the night
// before, since a visit is an hour, not a crew and a truck.
export async function notifyVisitReminder(q: QuoteInfo): Promise<SendResult> {
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}. Just a reminder - we'll be out tomorrow for your free quote visit:`,
      "",
      when,
      "",
      q.address?.trim() || null,
      "",
      `See you then! Call or text ${phoneDisplay} if anything changes.`,
    ]),
    { quoteId: q.id, kind: "visit_reminder", role: "customer" },
  );
}

export async function notifyVisitReminderCrew(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  contractorName?: string | null,
  delayMinutes = 0,
): Promise<SendResult | null> {
  if (!contractorPhone) return null;
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return sendSmsResult(
    contractorPhone,
    text([
      "QUOTE VISIT TOMORROW",
      "",
      greeting,
      "you have a quote visit tomorrow:",
      "",
      ...block("When:", when),
      customerBrief(q),
      "",
      `Can't make it? Call ${CALL_NUMBER} as soon as you know.`,
      "",
      q.job_token ? jobLink(q.job_token) : null,
    ]),
    { quoteId: q.id, kind: "visit_reminder", role: "crew" },
    { delayMinutes },
  ).catch(() => null);
}

// ── 14. 48h follow-up: a sent quote nobody has accepted or declined ────────
// Says the quote is waiting, never the price (see `usd`). The days-left line is
// what moves people; a decision with no deadline gets postponed.
export async function notifyQuoteFollowup(q: QuoteInfo, daysLeft?: number | null): Promise<SendResult> {
  const deadline =
    daysLeft != null && daysLeft > 0
      ? daysLeft === 1
        ? "It expires tomorrow."
        : `It expires in ${daysLeft} days.`
      : null;

  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "your concrete project is waiting! Accept or decline your quote now:",
      "",
      quoteLink(q.public_token ?? ""),
      "",
      deadline,
      "",
      `Questions? Call or text ${phoneDisplay} any time.`,
    ]),
    { quoteId: q.id, kind: "quote_followup", role: "customer" },
  );
}

// ── 11. Job complete + paid: thank the customer and ask for a review ────────
export async function notifyComplete(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "thank you for choosing us and for supporting a local business. We hope you love how it turned out!",
      ...(REVIEW_URL
        ? ["", "If you have a minute, a quick Google review would mean a lot to our small team:", REVIEW_URL]
        : []),
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "complete", role: "customer" },
  ).catch(() => {});
}

// ── Payment: text the customer their card link ──────────────────────────────
// The crew's "send a card link" button. States the amount and stops: the page
// handles deposit vs balance, and arguing for payment reads like collections.
export async function notifyPayLink(q: QuoteInfo, dueCents: number): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `here's your secure payment link for your project with ${BUSINESS}.`,
      "",
      ...(dueCents > 0 ? [`Balance: ${money(dueCents)}`, ""] : []),
      payLink(q.public_token ?? ""),
      "",
      "Card, Apple Pay or Google Pay. You can pay it all or part of it.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "pay_link", role: "customer" },
  );
}

// ── Payment: the crew took money on site ────────────────────────────────────
// Cash counts as soon as the crew records it, so this text IS the control: the
// owner hears immediately, while a mistake is still cheap to fix.
export async function notifyCashRecorded(input: {
  q: QuoteInfo;
  amountCents: number;
  method: string;
  who: string;
  dueCents: number;
  feeOwedCents: number;
}): Promise<void> {
  const { q, amountCents, method, who, dueCents, feeOwedCents } = input;
  await alertOwner(
    text([
      `PAYMENT RECORDED - ${method.toUpperCase()}`,
      "",
      ...block("Amount:", money(amountCents)),
      ...block("Customer:", q.name),
      ...block("Taken by:", who),
      ...block("Still due from customer:", dueCents > 0 ? money(dueCents) : "Nothing - paid in full"),
      // Card payments pay the office automatically; cash doesn't, so the fee is
      // now a debt the owner should hear about now, not at month end.
      ...block("They now owe you:", feeOwedCents > 0 ? money(feeOwedCents) : "Nothing on this job"),
      q.job_token ? jobLink(q.job_token) : null,
    ]),
    null,
    { quoteId: q.id, kind: "cash_recorded" },
  );
}

// Everything the contractor needs to call the customer without opening anything.
// The job link needs a CRM login, so the text says so up front.
export function assignmentMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return text([
    greeting,
    `you've been assigned a new job with ${BUSINESS}.`,
    "",
    customerBrief(q),
    // No token, no link: a bare ".../job/" looks tappable and goes nowhere.
    ...(q.job_token
      ? ["", "Full details and photos:", jobLink(q.job_token), "", "Sign in with your CRM login to open it."]
      : []),
    "",
    `Please give ${firstName(q.name)} a call to introduce yourself and confirm the details.`,
  ]);
}

// ── A payment the office had to correct ─────────────────────────────────────
// The crew acted on a figure that changed: what's left to collect and what they
// owe the office. Never sent to whoever made the correction.
export async function notifyPaymentCorrected(input: {
  q: QuoteInfo;
  contractorPhone?: string | null;
  actorPhone?: string | null;
  fromCents: number;
  /** Null means the row was voided rather than re-figured. */
  toCents: number | null;
  method: string;
  who: string;
  dueCents: number;
  feeOwedCents: number;
}): Promise<void> {
  const { q, fromCents, toCents, method, who } = input;
  const what =
    toCents === null
      ? `${money(fromCents)} recorded as ${method} has been taken off this job - it should not have been there.`
      : `The ${money(fromCents)} recorded as ${method} was wrong. It is now ${money(toCents)}.`;

  const msg = text([
    "PAYMENT CORRECTED",
    "",
    ...block("Customer:", q.name),
    what,
    "",
    ...block("Still to collect:", money(input.dueCents)),
    // Their balance with the office is a percentage of what was actually collected.
    ...block("You owe the office:", money(input.feeOwedCents)),
    `Corrected by ${who}.`,
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);

  await alertOwner(msg, input.actorPhone, { quoteId: q.id, kind: "payment_corrected" });
  if (input.contractorPhone && !samePhone(input.contractorPhone, input.actorPhone)) {
    await sendSms(input.contractorPhone, msg, {
      quoteId: q.id,
      kind: "payment_corrected",
      role: "crew",
    }).catch(() => {});
  }
}

export async function notifyAssignment(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  contractorName?: string | null,
): Promise<void> {
  if (!contractorPhone) return;
  await sendSms(contractorPhone, assignmentMessage(q, contractorName), {
    quoteId: q.id,
    kind: "assignment",
    role: "crew",
  }).catch(() => {});
}
