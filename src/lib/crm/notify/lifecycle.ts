// Server-only SMS notifications: lead, quote, approval, scheduling, change and visit texts. Never import from a client component.
// Re-exported from ../notify.ts, whose header documents the provider settings.
import { phoneDisplay } from "@/lib/site-data";
import { QUOTE_TTL_DAYS } from "../constants";
// Ledger money is in cents and must print with them ("$6,172.50", not
// "$6,172.5"), unlike the local dollars-only `usd`.
import { usd as money } from "../fees";
import { type SendResult, samePhone, sendSmsResult, sendSms, alertOwner } from "./send";
import {
  OWNER_NAME,
  BUSINESS,
  OPT_OUT_LINE,
  CALL_NUMBER,
  block,
  text,
  type QuoteInfo,
  type ChosenOption,
  firstName,
  usd,
  dayOrNull,
  prettyDay,
  customerBrief,
  dayAndTime,
} from "./format";
import { jobLink, quoteLink, payLink, newQuoteMessage, assignmentMessage } from "./templates";

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
          q.visit_moved
            ? `this is ${OWNER_NAME} with ${BUSINESS}. The time you picked wasn't open, so we've booked you the next one for your free in-person quote:`
            : `this is ${OWNER_NAME} with ${BUSINESS}. You're set for your free in-person quote:`,
          "",
          `${prettyDay(q.visit_date)}${q.visit_time ? ` at ${q.visit_time}` : ""}`,
          "",
          q.visit_moved
            ? "If that doesn't work, just reply with a better time."
            : "We look forward to meeting you. Reply or call if anything changes.",
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

/**
 * The change they were texted about has been withdrawn, so their link no
 * longer shows it. Without this they open the link to nothing to approve.
 */
export async function notifyChangeWithdrawn(q: QuoteInfo): Promise<SendResult> {
  return sendSmsResult(
    q.phone,
    text([
      `Hi ${firstName(q.name)},`,
      "please ignore the change we texted you about. It's been withdrawn, and your price is the same as you agreed.",
      "",
      q.scheduled_date ? `Your date doesn't move: ${dayAndTime(q)}.` : null,
      q.scheduled_date ? "" : null,
      "Questions, just call.",
      "",
      BUSINESS,
    ]),
    { quoteId: q.id, kind: "change_withdrawn", role: "customer" },
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
