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
import { phoneDisplay } from "@/lib/site-data";
import { QUOTE_TTL_DAYS, noEmDash, visitDateOf } from "./constants";
import { SITE_ORIGIN } from "./env";
import { getOwnerContacts, getOwnerPhones, logMessage, type SmsLog } from "./queries";

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

// Write the attempt to the message log. Every exit path from sendSmsResult goes
// through here, including the ones that never reach the provider: "we never
// tried, the number was unparseable" is exactly the kind of failure that used to
// vanish, and it looks identical to success from the outside.
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

// Detailed send - returns why it failed (used by the diagnostic endpoint).
// Pass `log` and the attempt is recorded against the job; omit it for sends that
// belong to no job, like the Settings test text.
export async function sendSmsResult(toRaw: string, messageRaw: string, log?: SmsLog): Promise<SendResult> {
  // Every text goes through the dash guard, not just the ones written today.
  // Doing it here rather than in each builder means a message assembled from
  // owner-typed content (a quote summary, a service name) is covered too.
  // Normalised before the log is written, so the log shows what was sent.
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
    await record(log, r, to, message);
    return r;
  } catch (e) {
    console.error("[sms] threw", e);
    const thrown: SendResult = { ok: false, provider: SMS_PROVIDER, to, detail: String(e) };
    await record(log, thrown, to, message);
    return thrown;
  }
}

export async function sendSms(toRaw: string, message: string, log?: SmsLog): Promise<boolean> {
  return (await sendSmsResult(toRaw, message, log)).ok;
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

  // Saved owner profiles win outright. OWNER_PHONE is a bootstrap for before
  // anyone has saved a number, not a permanent extra recipient: previously the
  // two were unioned, so a stale env var kept texting a number nobody could see
  // or remove from inside the app.
  try {
    for (const p of await getOwnerPhones()) add(p);
  } catch {
    // ignore - the env fallback below still applies
  }
  if (recipients.size === 0) add(OWNER_PHONE);

  const exclude = excludeRaw ? toE164(excludeRaw) : null;
  if (exclude) recipients.delete(exclude);
  return [...recipients.values()];
}

// The same list, but each number says where it came from. A bare list of digits
// can't tell you which knob to turn when a number you don't recognise is
// receiving your alerts: one lives in a Vercel env var, the others are staff
// profiles you can edit in the CRM.
// `active` is false for a number that is configured but no longer used, which
// is the case for OWNER_PHONE once any owner has saved a number in their
// profile. Showing it greyed out beats hiding it: a number in an env var you've
// forgotten about is exactly the thing you want the app to point at.
export type OwnerRecipient = { phone: string; source: "env" | "profile"; who: string; active: boolean };

export async function ownerRecipientDetails(): Promise<OwnerRecipient[]> {
  const byPhone = new Map<string, OwnerRecipient>();

  try {
    for (const o of await getOwnerContacts()) {
      const e = toE164(o.phone);
      if (e) byPhone.set(e, { phone: e, source: "profile", who: o.name, active: true });
    }
  } catch {
    // ignore - the env entry below still applies
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

// Every active owner gets a copy, with the acting user excluded so they aren't
// texted about their own clicks.
export async function alertOwner(
  message: string,
  excludeRaw?: string | null,
  log?: Omit<SmsLog, "role">,
): Promise<void> {
  const recipients = await ownerRecipients(excludeRaw);
  if (recipients.length === 0) {
    console.error("[sms] alertOwner: no owner recipients (set OWNER_PHONE or an owner's phone in Settings)");
    // Record the miss. An alert that was never addressed to anyone is the
    // hardest failure to notice, because nothing errored and nothing arrived.
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

// Used to introduce the business in the FIRST text a customer ever gets, and
// nowhere else. A name on that one message is a person saying hello; a name on
// every message afterwards ties the whole thread to one individual, which stops
// being true the moment anyone else picks up the phone. Everything after the
// introduction speaks as the business.
const OWNER_NAME = (process.env.OWNER_NAME || "Noah").trim();
const REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || "").trim();
const BUSINESS = "Raleigh Concrete Group";

// The opt-out notice goes in the FIRST message we ever send someone, and only
// there. It has to be stated plainly at least once; repeating it on every text
// trains people to skip past it and makes each message longer for nothing.
//
// STOP works on every message regardless of whether we print this line: the
// carrier and the SMS provider honour it before it ever reaches this app, so a
// customer is never stuck receiving texts because a later message didn't say so.
const OPT_OUT_LINE = "Reply STOP any time to stop these texts.";
// The number the crew should call when they can't make an appointment. Falls
// back to the main business line from site-data rather than a second copy of
// the digits, so there's one place a phone number is ever written down.
const CALL_NUMBER = (process.env.OWNER_CALL_NUMBER || phoneDisplay).trim();

// Every message in this file is built from lines, not sentences. A text arrives
// as one wall of grey on a phone unless the important parts are given their own
// line, and the crew reads these on a job site while holding something else.
// `block("Label:", value)` is the shape used throughout: label, value, blank.
function block(label: string, ...values: (string | null | undefined)[]): string[] {
  const clean = values.filter((v): v is string => Boolean(v && v.trim()));
  return clean.length ? [label, ...clean, ""] : [];
}

// Joins lines and collapses any run of blank lines to one, so an omitted block
// never leaves a gap in the middle of a message.
function text(lines: (string | null | undefined)[]): string {
  return lines
    .filter((l): l is string => l !== null && l !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type QuoteInfo = {
  // The job this message belongs to, so the send can be logged against it and
  // read back on the job page. Optional only because a couple of callers text
  // about something that isn't a job yet.
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
  visit_date?: string | null;
  visit_time?: string | null;
  public_token?: string;
  job_token?: string;
};

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";
// PRICE NEVER GOES IN A CUSTOMER TEXT.
//
// A figure in a text is a figure out of context: no scope beside it, no
// what's-included, nothing to answer the question it immediately raises. It
// also gets forwarded, screenshotted and shopped around on its own. The
// customer sees their number on their quote page, next to the five sections
// that explain it, and the texts carry the link instead.
//
// So `usd` is for OWNER and CREW messages only. Before using it, check the
// `role` on the send: "owner" and "crew" may show money, "customer" may not.
const usd = (n?: number | null) => (n != null ? `$${Number(n).toLocaleString("en-US")}` : null);

// 1st, 2nd, 3rd, 4th... Spelled-out dates read as a date rather than as data,
// which matters when the whole message is one line on a lock screen.
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

// "Friday, August 29th". Honest when there isn't a date: a crew text shouldn't
// say "your scheduled day" for a job nobody has booked yet.
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

// The customer block shared by every crew-facing text. One field per line, not
// full label-above-value blocks: this is embedded inside longer messages, and
// spacing out five fields would push a crew reminder past four SMS segments for
// no gain in readability. The important thing is that nothing runs together.
// Only fields we actually have are included, so a sparse lead doesn't produce
// "Address: null".
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
// The owner's version is laid out in labelled blocks rather than one run-on
// line: a new lead is usually read on a phone while doing something else, and
// the name and number need to be scannable without parsing a sentence.
export function newQuoteMessage(q: QuoteInfo): string {
  // Free text from the customer, so cap it - an essay shouldn't turn one alert
  // into a ten-part text.
  const raw = q.details?.trim();
  const details = raw ? (raw.length > 400 ? `${raw.slice(0, 400)}…` : raw) : null;
  // Raw here, not visitDateOf: this message shows an online request's fallback
  // slot too, and the label below is what says which of the two it is.
  const visitDay = dayOrNull(q.visit_date);

  return text([
    ...block("New Quote Request for:", q.name),
    ...block("Job Type:", q.service?.trim() || "Not specified"),
    ...block("Customer Phone:", q.phone),
    ...block("Address:", q.address?.trim()),
    // Which kind of quote this is decides what the reader does next: an online
    // request is desk work today, an in-person one is a drive on a set day.
    // Left off entirely for older leads that predate the choice.
    ...block(
      "Quote Type:",
      q.quote_type === "online" ? "Online - price it from the photos" : q.quote_type === "inperson" ? "In person" : null,
    ),
    // The same date means two different things, so it is never labelled the
    // same way. On an online request it's the customer's fallback slot and the
    // label has to say out loud that nobody has agreed to it, or the crew reads
    // a booking into a maybe and drives out.
    ...block(
      q.quote_type === "online" ? "If a visit is needed, they asked for:" : "Visit Booked:",
      visitDay
        ? `${visitDay}${q.visit_time ? ` at ${q.visit_time}` : ""}${
            q.quote_type === "online" ? " (not confirmed - confirm it on the job page)" : ""
          }`
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
    // Same full brief as a manual assignment - from the crew's side this is the
    // same event, so it shouldn't read differently.
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
    q.quote_type === "inperson"
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
      : // Deliberately promises a follow-up, not a price or a timeframe. Pricing
        // depends on the project, and committing to "your price shortly" up
        // front sets an expectation the job can't always meet.
        //
        // The slot they picked is repeated back so they know we have it, and
        // named as a maybe in the same breath. They must not put us in their
        // calendar off this text - nobody is coming until we confirm.
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
  await sendSms(q.phone, msg, { quoteId: q.id, kind: "received", role: "customer" }).catch(() => {});
}

// ── 4. Contractor confirms the visit an online customer offered ─────────────
// The moment a maybe becomes an appointment. Both sides get the same day and
// time in the same shape, because this is the text each of them will scroll
// back to on the morning.
export async function notifyVisitConfirmed(
  q: QuoteInfo,
  crewPhone?: string | null,
  crewName?: string | null,
  requested?: { date?: string | null; time?: string | null },
  fromOnline = true,
): Promise<void> {
  const when = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;

  // The customer asked for a photo quote and is getting a visit instead, so the
  // first thing this has to do is explain why - unexplained, a crew turning up
  // reads as a sales call. Measuring is the honest reason and it's in the
  // customer's interest, so it leads.
  //
  // The day is offered rather than announced. They picked this slot themselves
  // when they filled the form, but that was a maybe and it may have been weeks
  // ago, so it closes by inviting them to move it rather than assuming.
  //
  // If the crew put them on a different slot, say so and name only the part
  // that moved. "That's a change from Friday" when it is still Friday reads as
  // a mistake and costs a phone call.
  const movedDay = Boolean(requested?.date) && requested?.date !== q.visit_date;
  const movedTime = !movedDay && Boolean(requested?.time) && requested?.time !== q.visit_time;
  const wasAsked = movedDay ? prettyDay(requested?.date) : movedTime ? requested?.time : null;
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `this is ${BUSINESS}.`,
      "",
      // "Rather than price it off the photos" only makes sense to someone who
      // sent photos. A customer who booked an in-person quote from the start
      // never did, and telling them we've decided against a photo quote they
      // never asked for reads as a different job.
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

  if (crewPhone) {
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
    crewPhone,
    { quoteId: q.id, kind: "visit_confirmed" },
  ).catch(() => {});
}

// ── 5. Quote is ready: send the customer their link ─────────────────────────
// Carries the link and the deadline, never the number - see the note on `usd`.
// The deadline is stated here because this is the message they scroll back to,
// and a quote that quietly stops working is worse than one that said when it
// would.
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

// ── 5b. Quote is out: tell the office, and tell whoever pressed send ────────
// A quote leaving is a money moment nobody was being told about. The owner gets
// it because it's the point the job starts waiting on someone outside the
// business; the crew gets it because "did that actually go?" is the question
// that makes people press Send twice.
//
// Both messages key off whether the customer's text was actually accepted. A
// confident "quote sent" over a text that bounced is worse than saying nothing:
// everyone stops chasing a customer who never heard from us.
export async function notifyQuoteSent(
  q: QuoteInfo,
  sender: { name?: string | null; phone?: string | null; isOwner: boolean },
  delivered: boolean,
): Promise<void> {
  const by = sender.name?.trim() || "A contractor";

  await alertOwner(
    delivered
      ? text([
          "QUOTE SENT",
          "",
          ...block("Sent by:", by),
          ...block("Customer:", q.name),
          ...block("Amount:", usd(q.quote_amount)),
          "Waiting on them to approve or decline.",
        ])
      : text([
          "QUOTE TEXT FAILED",
          "",
          ...block("Tried by:", by),
          ...block("Customer:", q.name),
          ...block("Their number:", q.phone),
          "The quote link did NOT reach them. Give them a call.",
        ]),
    // Whoever pressed the button doesn't need to be told what they just did.
    sender.phone,
    { quoteId: q.id, kind: "quote_sent" },
  ).catch(() => {});

  // The owner is looking at the result on screen; a contractor is on a job site
  // holding a phone, where a text is the only thing that persists.
  if (sender.isOwner || !sender.phone) return;

  await sendSms(
    sender.phone,
    delivered
      ? text([
          `Hi ${firstName(by)},`,
          `your quote for ${q.name} has been sent.`,
          "",
          ...block("Amount:", usd(q.quote_amount)),
          "Now wait for them to review it. You'll get a text as soon as they approve or decline - there's no need to send it again.",
        ])
      : text([
          `Hi ${firstName(by)},`,
          `your quote for ${q.name} did NOT go out - the text to them failed.`,
          "",
          `Please call ${CALL_NUMBER} so we can reach them another way.`,
        ]),
    { quoteId: q.id, kind: "quote_sent", role: "crew" },
  ).catch(() => {});
}

// ── 6. Customer approved: thank them, but don't promise a day yet ───────────
// They've proposed dates; the crew confirms one. Saying "we'll confirm" here is
// what stops the customer assuming their first choice is locked in.
export async function notifyCustomerApproved(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "thanks for approving your quote.",
      "",
      "We're checking the crew's schedule against the days you picked and will text you shortly to confirm your project date and time.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "approved", role: "customer" },
  ).catch(() => {});
}

// ── 6b. Approved: tell the owner + crew it needs a date ─────────────────────
export async function notifyNeedsScheduling(q: QuoteInfo, contractorPhone?: string | null): Promise<void> {
  const picks = (q.preferred_dates ?? []).map((d) => dayOrNull(d)).filter((d): d is string => Boolean(d));
  const wanted = picks.length ? block("Customer prefers:", ...picks) : block("Customer prefers:", "No days given");

  await alertOwner(
    text([
      "QUOTE APPROVED",
      "",
      ...block("Customer:", q.name),
      ...block("Amount:", usd(q.quote_amount)),
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

// The day plus the crew's start time, e.g. "Monday, August 17 at 9:00 AM".
// Every customer-facing mention of the appointment goes through this so the
// time can never silently drop out of one message but not another.
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

// The date moved. Say so plainly rather than re-sending the "booked" text, which
// reads as a mistake when the customer already had a different day. The old and
// new times each get their own line: this is the message most likely to be
// misread, and a customer skimming it has to come away with the right day.
export async function notifyCustomerRescheduled(
  q: QuoteInfo,
  previous?: string | null,
  previousTime?: string | null,
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;

  // No previous date on file: there's nothing to move "from", so state the new
  // one rather than printing a dangling "from:".
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
// The visit is an appointment the customer set aside time for, so moving or
// dropping it gets the same courtesy as a booked job.
export async function notifyVisitMoved(
  q: QuoteInfo,
  previous?: string | null,
  previousTime?: string | null,
): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;
  const now = `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`;

  const body = was
    ? [`your free quote visit with ${BUSINESS} has been moved from:`, "", was, "to:", now]
    : [`your free quote visit with ${BUSINESS} has been moved to:`, "", now];

  await sendSms(
    q.phone,
    text([`Hi ${firstName(q.name)},`, ...body, "", "Sorry for the change, call or text us if that time doesn't work."]),
    { quoteId: q.id, kind: "visit_moved", role: "customer" },
  ).catch(() => {});
}

export async function notifyVisitCancelled(q: QuoteInfo): Promise<void> {
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      `we've had to cancel your quote visit with ${BUSINESS}${
        dayOrNull(q.visit_date) ? ` on ${dayOrNull(q.visit_date)}` : ""
      }.`,
      "",
      "We're sorry for the trouble. Call or text us and we'll get you booked back in.",
    ]),
    { quoteId: q.id, kind: "visit_cancelled", role: "customer" },
  ).catch(() => {});
}

// A booked work day was removed. The customer is expecting a crew, so this is
// the one cancellation that must never be silent.
export async function notifyBookingCancelled(q: QuoteInfo, previous?: string | null, previousTime?: string | null): Promise<void> {
  const wasDay = dayOrNull(previous);
  const was = wasDay ? `${wasDay}${previousTime ? ` at ${previousTime}` : ""}` : null;
  await sendSms(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      was
        ? `we've had to release your project date with ${BUSINESS}:`
        : `we've had to release your project date with ${BUSINESS}.`,
      ...(was ? ["", was] : []),
      "",
      "Your project is still on. We're working out a new date and will text you as soon as we have one.",
      "",
      "Sorry for the change, call or text us any time.",
    ]),
    { quoteId: q.id, kind: "booking_cancelled", role: "customer" },
  ).catch(() => {});
}

export async function notifyBooked(
  q: QuoteInfo,
  contractorPhone?: string | null,
  previous?: string | null,
  previousTime?: string | null,
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

  await alertOwner(msg, null, { quoteId: q.id, kind: "booked" });
  if (contractorPhone) {
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
// Sent 3 days out, 1 day out and the morning of. Every one of them repeats the
// address, the start time and how to bail out, because the whole point is that
// a crew member who can't make it says so while there's still time to cover it,
// rather than the customer finding out by nobody showing up.
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
): Promise<SendResult | null> {
  if (!contractorPhone) return null;
  return sendSmsResult(contractorPhone, crewReminderMessage(q, daysOut, contractorName), {
    quoteId: q.id,
    kind: `crew_reminder_${daysOut}`,
    role: "crew",
  }).catch(() => null);
}

// ── 12. Stale lead: still nothing sent 12h after it came in ────────────────
// An in-person request arrives with a visit already on the books (the customer
// picks the slot on the form), so "no visit scheduled" would be plainly wrong
// on half of these. What's actually true of every one of them is that nobody
// has sent a price yet - so that's what it says, and the next step names
// whichever one this lead is actually waiting on.
export function staleLeadMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  const hasVisit = Boolean(dayOrNull(visitDateOf(q)));
  return text([
    "LEAD NEEDS ATTENTION",
    "",
    greeting,
    "this lead came in over 12 hours ago and no quote has gone out yet:",
    "",
    customerBrief(q),
    "",
    hasVisit
      ? "The visit is booked - send their price once you've seen it, or call them if anything's changed."
      : "Send them a quote, or confirm a visit if you need to see it first.",
    "",
    q.job_token ? jobLink(q.job_token) : null,
  ]);
}

export async function notifyStaleLead(
  contractorPhone: string | null | undefined,
  q: QuoteInfo,
  contractorName?: string | null,
): Promise<void> {
  const msg = staleLeadMessage(q, contractorName);
  await alertOwner(msg, contractorPhone, { quoteId: q.id, kind: "stale_lead" });
  if (contractorPhone) {
    await sendSms(contractorPhone, msg, { quoteId: q.id, kind: "stale_lead", role: "crew" }).catch(() => {});
  }
}

// ── 13. Quote visit, night before: customer + contractor ───────────────────
// The 2-day reminder above (notifyReminder) is for a booked WORK day. This is
// the equivalent for the free in-person quote VISIT - one reminder, the night
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
  ).catch(() => null);
}

// ── 14. 48h follow-up: a sent quote nobody has accepted or declined ────────
// Says the quote is waiting, never what it costs - see the note on `usd`.
// The days-left line is the part that actually moves people: a decision with
// no deadline gets postponed indefinitely, and this one has a real one.
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
      "thanks so much for your business and for supporting local.",
      ...(REVIEW_URL
        ? ["", "If you were happy with the work, we'd love a quick review:", REVIEW_URL]
        : []),
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "complete", role: "customer" },
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
    text([
      `Hi ${firstName(q.name)},`,
      `your project with ${BUSINESS} is complete.`,
      "",
      // The amount they agreed to is on their quote page and not in this
      // text - see the note on `usd`. An accepted quote's page never expires,
      // so this link keeps working however long the job ran.
      ...(q.public_token ? ["Your approved total is on your quote:", quoteLink(q.public_token), ""] : []),
      "How to pay:",
      how,
      "",
      "Thank you for your business.",
    ]),
    { quoteId: q.id, kind: "payment_request", role: "customer" },
  );
}

// Assignment from the CRM: give the contractor everything they need to pick up
// the phone without opening anything first, then point them at the full job.
// The job link needs a CRM session now, so the text says so up front rather
// than letting them tap through to a login screen with no explanation.
export function assignmentMessage(q: QuoteInfo, contractorName?: string | null): string {
  const greeting = contractorName?.trim() ? `Hi ${firstName(contractorName)},` : "Hi,";
  return text([
    greeting,
    `you've been assigned a new job with ${BUSINESS}.`,
    "",
    customerBrief(q),
    // The link is skipped rather than half-built when there's no token. A bare
    // ".../job/" is worse than no link: it looks tappable and goes nowhere.
    ...(q.job_token
      ? ["", "Full details and photos:", jobLink(q.job_token), "", "Sign in with your CRM login to open it."]
      : []),
    "",
    `Please give ${firstName(q.name)} a call to introduce yourself and confirm the details.`,
  ]);
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
