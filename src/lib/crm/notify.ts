// Server-only SMS notifications. Never import from a client component.
//
// Provider is chosen with SMS_PROVIDER; if unset we default to "quo" when a
// QUO_API_KEY is present, otherwise "twilio".
//   Quo (OpenPhone):  QUO_API_KEY, QUO_FROM (E.164), optional QUO_USER_ID
//   Twilio:           TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   Custom:           SMS_API_URL, SMS_API_KEY, SMS_FROM  (POSTs { to, from, message })
// OWNER_PHONE receives the owner alerts ("my number").
//
// Every send is best-effort: it is wrapped so a texting outage can never break a
// quote submission or a CRM save. Failures are logged (Vercel → Logs) with an
// [sms] prefix so they can be diagnosed.
import { SITE_ORIGIN } from "./env";
import { getOwnerPhones } from "./queries";

export const SMS_PROVIDER = (process.env.SMS_PROVIDER || (process.env.QUO_API_KEY ? "quo" : "twilio")).toLowerCase();
const OWNER_PHONE = process.env.OWNER_PHONE || "";

export type SendResult = {
  ok: boolean;
  provider: string;
  to?: string;
  // The number we sent from, so a failure log shows both ends of the attempt.
  from?: string;
  status?: number;
  detail?: string;
};

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
  if (!key) return { ok: false, provider: "quo", detail: "QUO_API_KEY is not set" };
  if (!from) return { ok: false, provider: "quo", detail: "QUO_FROM is not set" };
  // Quo can't text a number from itself; it fails as an opaque 500 rather than a
  // validation error, so catch it here where we can say what's actually wrong.
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
  // Their 500 "Unknown" says nothing useful on its own; add the two things that
  // actually cause it so the message is actionable.
  if (!res.ok && res.status >= 500) {
    detail = `${detail ?? ""}\n\nQuo returned a server error. Usually this means the destination number can't receive texts (landline/VoIP), or your workspace can't message it. Check the number, then try another one in Settings → Text notifications.`;
  }
  return { ok: res.ok, provider: "quo", to, from, status: res.status, detail };
}

async function sendTwilio(to: string, message: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const auth = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";
  if (!sid || !auth || !from) return { ok: false, provider: "twilio", detail: "Twilio env vars missing" };
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
  if (!url) return { ok: false, provider: "custom", detail: "SMS_API_URL is not set" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ to, from, message }),
  });
  const detail = res.ok ? undefined : await res.text().catch(() => "");
  return { ok: res.ok, provider: "custom", to, status: res.status, detail };
}

// Detailed send - returns why it failed (used by the diagnostic endpoint).
export async function sendSmsResult(toRaw: string, message: string): Promise<SendResult> {
  const to = toE164(toRaw);
  if (!to) return { ok: false, provider: SMS_PROVIDER, detail: `Invalid phone number: "${toRaw}"` };
  if (!message) return { ok: false, provider: SMS_PROVIDER, to, detail: "Empty message" };
  try {
    let r: SendResult;
    if (SMS_PROVIDER === "quo" || SMS_PROVIDER === "openphone") r = await sendQuo(to, message);
    else if (SMS_PROVIDER === "custom") r = await sendCustom(to, message);
    else r = await sendTwilio(to, message);
    if (!r.ok) {
      console.error("[sms] send failed", {
        provider: r.provider,
        from: r.from,
        to,
        status: r.status,
        detail: r.detail,
      });
    }
    return r;
  } catch (e) {
    console.error("[sms] threw", e);
    return { ok: false, provider: SMS_PROVIDER, to, detail: String(e) };
  }
}

export async function sendSms(toRaw: string, message: string): Promise<boolean> {
  return (await sendSmsResult(toRaw, message)).ok;
}

// Everyone who receives an owner alert: the OWNER_PHONE env plus every active
// owner's saved number, de-duplicated in E.164. Exported so the Settings
// diagnostics can show exactly who a real alert would reach, rather than
// re-deriving the list and drifting from what alertOwner actually does.
export async function ownerRecipients(excludeRaw?: string | null): Promise<string[]> {
  const recipients = new Map<string, string>();
  const add = (raw?: string | null) => {
    const e = raw ? toE164(raw) : null;
    if (e) recipients.set(e, e);
  };
  add(OWNER_PHONE);
  try {
    for (const p of await getOwnerPhones()) add(p);
  } catch {
    // ignore - fall back to OWNER_PHONE
  }
  const exclude = excludeRaw ? toE164(excludeRaw) : null;
  if (exclude) recipients.delete(exclude);
  return [...recipients.values()];
}

// Every active owner gets a copy, with the acting user excluded so they aren't
// texted about their own clicks.
export async function alertOwner(message: string, excludeRaw?: string | null): Promise<void> {
  const recipients = await ownerRecipients(excludeRaw);
  if (recipients.length === 0) {
    console.error("[sms] alertOwner: no owner recipients (set OWNER_PHONE or an owner's phone in Settings)");
    return;
  }
  await Promise.all(recipients.map((p) => sendSms(p, message).catch(() => {})));
}

// What's configured right now, for the Settings → Notifications panel. Never
// returns a key or token: only whether each one is present, so this is safe to
// render in the CRM.
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

// The owner's first name used to sign customer-facing texts.
const OWNER_NAME = (process.env.OWNER_NAME || "Noah").trim();
const REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || "").trim();

type QuoteInfo = {
  name: string;
  phone: string;
  service?: string | null;
  address?: string | null;
  quote_type?: string | null;
  quote_amount?: number | null;
  scheduled_date?: string | null;
  preferred_dates?: string[] | null;
  visit_date?: string | null;
  visit_time?: string | null;
  public_token?: string;
  job_token?: string;
};

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";
const money = (n?: number | null) => (n != null ? ` for $${Number(n).toLocaleString("en-US")}` : "");
function prettyDay(ymd?: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "your scheduled day";
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// Same date, but honest when there isn't one - a crew text shouldn't say "your
// scheduled day" for a job nobody has booked yet.
function dayOrNull(ymd?: string | null): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// The customer block shared by every crew-facing text. Only lines we actually
// have are included, so a sparse lead doesn't produce "Address: null".
function customerBrief(q: QuoteInfo): string {
  const lines = [`Customer: ${q.name}`, `Phone: ${q.phone}`];
  if (q.service?.trim()) lines.push(`Service: ${q.service.trim()}`);
  if (q.address?.trim()) lines.push(`Address: ${q.address.trim()}`);

  const jobDay = dayOrNull(q.scheduled_date);
  const visitDay = dayOrNull(q.visit_date);
  if (jobDay) lines.push(`Scheduled: ${jobDay}`);
  else if (visitDay) lines.push(`Quote visit: ${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}`);
  else lines.push("Not scheduled yet");

  return lines.join("\n");
}

// ── 1. New quote in: text the owner(s) and the auto-assigned contractor ─────
export async function notifyNewQuote(
  q: QuoteInfo,
  contractorPhone?: string | null,
  contractorName?: string | null,
): Promise<void> {
  const kind = q.service?.trim() || "concrete";
  await alertOwner(`New quote: ${q.name}, ${kind}. ${q.phone}. ${jobLink(q.job_token ?? "")}`);
  if (contractorPhone) {
    // Same full brief as a manual assignment - from the crew's side this is the
    // same event, so it shouldn't read differently.
    await sendSms(contractorPhone, assignmentMessage(q, contractorName)).catch(() => {});
  }
}

// ── 3. Acknowledge the customer the moment their request lands ──────────────
export async function notifyCustomerReceived(q: QuoteInfo): Promise<void> {
  let msg: string;
  if (q.quote_type === "inperson") {
    msg = `Hi ${firstName(q.name)}, this is ${OWNER_NAME} with Raleigh Concrete Group. You're set for an in-person quote on ${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}. We look forward to meeting you. Reply or call if anything changes.`;
  } else {
    msg = `Hi ${firstName(q.name)}, this is ${OWNER_NAME} with Raleigh Concrete Group. We got your quote request and are reviewing the details now. We'll text your price shortly. Thanks for reaching out.`;
  }
  await sendSms(q.phone, msg).catch(() => {});
}

// ── 5. Quote is ready: send the customer their link ─────────────────────────
export async function notifyQuoteReady(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    `Hi ${firstName(q.name)}, our team reviewed your project and your quote is ready. View it here: ${quoteLink(q.public_token ?? "")}`,
  );
}

// ── 6. Customer approved: thank them, but don't promise a day yet ───────────
// They've proposed dates; the crew confirms one. Saying "we'll confirm" here is
// what stops the customer assuming their first choice is locked in.
export async function notifyCustomerApproved(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    `Thanks for approving your quote, ${firstName(q.name)}. We're checking the crew's schedule against the days you picked and will text you shortly to confirm your installation date.`,
  ).catch(() => {});
}

// ── 6b. Approved: tell the owner + crew it needs a date ─────────────────────
export async function notifyNeedsScheduling(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const picks = (q.preferred_dates ?? []).map((d) => dayOrNull(d)).filter(Boolean);
  const wanted = picks.length ? `Customer prefers: ${picks.join(", ")}.` : "No preferred days given.";
  await alertOwner(`APPROVED: ${q.name}${money(q.quote_amount)}. ${wanted} Needs a confirmed date.`);
  if (contractorPhone) {
    await sendSms(
      contractorPhone,
      [
        `${q.name} approved their quote — we need a date confirmed.`,
        "",
        customerBrief(q),
        "",
        wanted,
        "",
        `Confirm the day that works: ${jobLink(q.job_token ?? "")}`,
        "Sign in with your CRM login to pick it.",
      ].join("\n"),
    ).catch(() => {});
  }
}

// ── 7. Date confirmed by the crew: now we can promise the customer a day ────
export async function notifyCustomerScheduled(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    `Good news ${firstName(q.name)} — your project with Raleigh Concrete Group is booked for ${prettyDay(q.scheduled_date)}. We'll text a reminder before we arrive. Thanks for your business.`,
  ).catch(() => {});
}

// The date moved. Say so plainly rather than re-sending the "booked" text, which
// reads as a mistake when the customer already had a different day.
export async function notifyCustomerRescheduled(q: QuoteInfo, previous?: string | null): Promise<void> {
  const was = dayOrNull(previous);
  await sendSms(
    q.phone,
    `Hi ${firstName(q.name)}, your project with Raleigh Concrete Group has been moved${was ? ` from ${was}` : ""} to ${prettyDay(q.scheduled_date)}. Sorry for the change — call or text us if that day doesn't work.`,
  ).catch(() => {});
}

export async function notifyBooked(
  q: QuoteInfo,
  contractorPhone?: string | null,
  previous?: string | null,
): Promise<void> {
  const was = dayOrNull(previous);
  const headline = was ? `DATE CHANGED (${was} → ${prettyDay(q.scheduled_date)})` : `JOB BOOKED: ${prettyDay(q.scheduled_date)}`;
  const msg = [`${headline} — ${q.name}${money(q.quote_amount)}`, "", customerBrief(q), "", jobLink(q.job_token ?? "")].join("\n");
  await alertOwner(msg);
  if (contractorPhone) await sendSms(contractorPhone, msg).catch(() => {});
}

// ── 6. Customer declined ────────────────────────────────────────────────────
export async function notifyDeclined(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = `${q.name} declined their quote. ${q.phone}`;
  await alertOwner(msg);
  if (contractorPhone) await sendSms(contractorPhone, msg).catch(() => {});
}

// ── 9. Two days out: ask the customer to confirm ────────────────────────────
export async function notifyReminder(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    `Hi ${firstName(q.name)}, this is Raleigh Concrete Group. Please confirm your job on ${prettyDay(q.scheduled_date)}: ${confirmLink(q.public_token ?? "")}`,
  );
}
export async function notifyUnconfirmed(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = `${q.name} could not confirm their job on ${prettyDay(q.scheduled_date)}. Please reach out: ${q.phone}`;
  await alertOwner(msg);
  if (contractorPhone) await sendSms(contractorPhone, msg).catch(() => {});
}

// ── 11. Job complete + paid: thank the customer and ask for a review ────────
export async function notifyComplete(q: QuoteInfo): Promise<void> {
  const review = REVIEW_URL ? ` If you were happy with the work, we'd love a quick review: ${REVIEW_URL}` : "";
  await sendSms(
    q.phone,
    `Thanks so much for your business and for supporting local, ${firstName(q.name)}.${review}`,
  ).catch(() => {});
}

// ── Payment: text the customer how to pay (Zelle / bank deposit) ────────────
// PAYMENT_INSTRUCTIONS holds your real payment details, e.g.
//   "Zelle to pay@raleighconcrete.net or 919-555-0142 (Raleigh Concrete Group)."
// Falls back to a safe generic line so a missing env var never sends a broken text.
const PAYMENT_INSTRUCTIONS = (process.env.PAYMENT_INSTRUCTIONS || "").trim();
export async function notifyPaymentRequest(q: QuoteInfo): Promise<SendResult> {
  const how = PAYMENT_INSTRUCTIONS || "Reply here and we'll send your payment details.";
  return sendSmsResult(
    q.phone,
    `Hi ${firstName(q.name)}, your project with Raleigh Concrete Group is complete${money(q.quote_amount)}. ${how} Thank you for your business.`,
  );
}

// Assignment from the CRM: give the contractor everything they need to pick up
// the phone without opening anything first, then point them at the full job.
// The job link needs a CRM session now, so the text says so up front rather
// than letting them tap through to a login screen with no explanation.
export function assignmentMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return [
    `${greeting} you've been assigned a new job with Raleigh Concrete Group.`,
    "",
    customerBrief(q),
    "",
    `Full details and photos: ${jobLink(q.job_token ?? "")}`,
    "Sign in with your CRM login to open it.",
    "",
    `Please give ${firstName(q.name)} a call to introduce yourself and confirm the details.`,
  ].join("\n");
}

export async function notifyAssignment(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  contractorName?: string | null,
): Promise<void> {
  if (!contractorPhone) return;
  await sendSms(contractorPhone, assignmentMessage(q, contractorName)).catch(() => {});
}
