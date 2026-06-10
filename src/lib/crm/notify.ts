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

type LeadLike = {
  name: string;
  phone: string;
  service?: string | null;
  city?: string | null;
  quote_type?: string | null;
  job_token: string;
};

export async function alertNewLead(lead: LeadLike): Promise<void> {
  const kind = lead.service?.trim() || "concrete";
  const where = lead.city?.trim() ? `, ${lead.city.trim()}` : "";
  const how = lead.quote_type === "online" ? "Photos attached." : "In-person visit.";
  await alertOwner(`New ${kind} lead — ${lead.name} ${lead.phone}${where}. ${how} ${jobLink(lead.job_token)}`);
}

export async function alertAssigned(contractorPhone: string | null | undefined, lead: LeadLike): Promise<void> {
  if (!contractorPhone) return;
  const kind = lead.service?.trim() || "concrete";
  await sendSms(
    contractorPhone,
    `New job assigned to you — ${kind} for ${lead.name} ${lead.phone}. Details + photos: ${jobLink(lead.job_token)}`,
  ).catch(() => {});
}
