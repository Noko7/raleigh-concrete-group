// Server-only SMS notifications. Never import from a client component.
//
// Provider is selected with SMS_PROVIDER ("twilio" by default, or "custom").
//   Twilio:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   Custom:  SMS_API_URL, SMS_API_KEY, SMS_FROM  (POSTs JSON { to, from, message })
// OWNER_PHONE receives the owner alerts ("my number").
//
// Every send is best-effort: it is wrapped so a texting outage can never break a
// quote submission or a CRM save.
import { SITE_ORIGIN } from "./env";

const PROVIDER = (process.env.SMS_PROVIDER || "twilio").toLowerCase();
const OWNER_PHONE = process.env.OWNER_PHONE || "";

function toE164(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const d = trimmed.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

async function sendTwilio(to: string, message: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const auth = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";
  if (!sid || !auth || !from) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  });
  return res.ok;
}

async function sendCustom(to: string, message: string): Promise<boolean> {
  const url = process.env.SMS_API_URL || "";
  const key = process.env.SMS_API_KEY || "";
  const from = process.env.SMS_FROM || "";
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ to, from, message }),
  });
  return res.ok;
}

export async function sendSms(toRaw: string, message: string): Promise<boolean> {
  const to = toE164(toRaw);
  if (!to || !message) return false;
  try {
    return PROVIDER === "custom" ? await sendCustom(to, message) : await sendTwilio(to, message);
  } catch {
    return false;
  }
}

export async function alertOwner(message: string): Promise<void> {
  if (OWNER_PHONE) await sendSms(OWNER_PHONE, message).catch(() => {});
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
