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

export type SendResult = { ok: boolean; provider: string; to?: string; status?: number; detail?: string };

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
  const res = await fetch("https://api.openphone.com/v1/messages", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, from, to: [to], ...(userId ? { userId } : {}) }),
  });
  const detail = res.ok ? undefined : await res.text().catch(() => "");
  return { ok: res.ok, provider: "quo", to, status: res.status, detail };
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

// Detailed send — returns why it failed (used by the diagnostic endpoint).
export async function sendSmsResult(toRaw: string, message: string): Promise<SendResult> {
  const to = toE164(toRaw);
  if (!to) return { ok: false, provider: SMS_PROVIDER, detail: `Invalid phone number: "${toRaw}"` };
  if (!message) return { ok: false, provider: SMS_PROVIDER, to, detail: "Empty message" };
  try {
    let r: SendResult;
    if (SMS_PROVIDER === "quo" || SMS_PROVIDER === "openphone") r = await sendQuo(to, message);
    else if (SMS_PROVIDER === "custom") r = await sendCustom(to, message);
    else r = await sendTwilio(to, message);
    if (!r.ok) console.error("[sms] send failed", { provider: r.provider, to, status: r.status, detail: r.detail });
    return r;
  } catch (e) {
    console.error("[sms] threw", e);
    return { ok: false, provider: SMS_PROVIDER, to, detail: String(e) };
  }
}

export async function sendSms(toRaw: string, message: string): Promise<boolean> {
  return (await sendSmsResult(toRaw, message)).ok;
}

// Every active owner gets a copy (their staff phone + the OWNER_PHONE env), with
// the acting user excluded so they aren't texted about their own clicks.
export async function alertOwner(message: string, excludeRaw?: string | null): Promise<void> {
  const recipients = new Map<string, string>();
  const add = (raw?: string | null) => {
    const e = raw ? toE164(raw) : null;
    if (e) recipients.set(e, e);
  };
  add(OWNER_PHONE);
  try {
    for (const p of await getOwnerPhones()) add(p);
  } catch {
    // ignore — fall back to OWNER_PHONE
  }
  const exclude = excludeRaw ? toE164(excludeRaw) : null;
  if (exclude) recipients.delete(exclude);
  if (recipients.size === 0) {
    console.error("[sms] alertOwner: no owner recipients (set OWNER_PHONE or an owner's phone in Settings)");
    return;
  }
  await Promise.all([...recipients.values()].map((p) => sendSms(p, message).catch(() => {})));
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

// ── 1. New quote in: text the owner(s) and the assigned contractor ──────────
export async function notifyNewQuote(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const kind = q.service?.trim() || "concrete";
  await alertOwner(`New quote: ${q.name}, ${kind}. ${q.phone}. ${jobLink(q.job_token ?? "")}`);
  if (contractorPhone) {
    await sendSms(contractorPhone, `New job for you: ${q.name}, ${kind}. Details: ${jobLink(q.job_token ?? "")}`).catch(() => {});
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

// ── 6 + 8. Customer booked: thank them, and text the crew the job details ───
export async function notifyCustomerScheduled(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    `Thank you for scheduling your project with Raleigh Concrete Group. You're set for ${prettyDay(q.scheduled_date)}. We'll send a reminder before we arrive. We appreciate your business.`,
  ).catch(() => {});
}
export async function notifyBooked(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const msg = `JOB BOOKED: ${q.name} on ${prettyDay(q.scheduled_date)}${money(q.quote_amount)}. ${q.address ?? ""}. ${q.phone}. ${jobLink(q.job_token ?? "")}`;
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

// Reassignment from the CRM: let the newly-assigned contractor know.
export async function notifyAssignment(contractorPhone: string | null | undefined, q: QuoteInfo): Promise<void> {
  if (!contractorPhone) return;
  const kind = q.service?.trim() || "concrete";
  await sendSms(contractorPhone, `New job for you: ${q.name}, ${kind}. Details: ${jobLink(q.job_token ?? "")}`).catch(() => {});
}
