# Notification workflow

Who gets told what, and when. Every message in the system is listed here.

**Design rules**

1. The customer hears from us only when something *they* care about changes.
   Internal work — assigning a contractor, editing a price, adding notes,
   dragging a card — never reaches them.
2. Nobody is texted about an action they performed themselves.
3. One message per real state change. No "just checking in" texts.
4. Texting is best-effort: an SMS outage never blocks a save, a booking, or a
   customer's approval.
5. **Every message is written as lines, not sentences.** Dates, times, phone
   numbers and addresses each get their own line, and the thing the reader has
   to act on is never buried mid-paragraph. See "Message formatting" below.

The one exception to rule 3 is the crew, who are reminded three times before a
job (see ⑥). Customers are not reminded more than once.

---

## The flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ ① LEAD ARRIVES                                        status: New   │
│    Customer submits the quote form                                  │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Thanks for reaching out — we got your request and we're  │
│            looking over the details. We'll follow up soon."         │
│            (in-person requests instead confirm the visit day/time)  │
│ OWNER     Labelled block: name, job type, phone, address,           │
│            details, job link (see "Owner: new lead format" below)   │
│ CREW      Full brief — customer, phone, service, address, timing    │
│            (only if auto-assigned to your primary contractor)       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                    ── silence until you send a price ──
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ② YOU SEND THE QUOTE                               status: Quoted   │
│    "Send Quote" on the job page (needs a price + description)       │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Your quote is ready: <link>"                             │
│ OWNER     nothing — you clicked it, the result is on screen         │
│ CREW      nothing                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                    ── waiting on the customer ──
                                 ▼
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
┌──────────────────────────────────┐  ┌──────────────────────────────┐
│ ③ APPROVES              approved │  │ ③b DECLINES        status:   │
│   Picks up to 3 days that suit   │  │    (offered a $150 credit    │
│   them. NOTHING IS BOOKED YET.   │  │     first)             Lost  │
├──────────────────────────────────┤  ├──────────────────────────────┤
│ CUSTOMER "Thanks for approving.  │  │ CUSTOMER  nothing — they saw │
│    We're checking the crew's     │  │            the confirmation  │
│    schedule and will text to     │  │ OWNER     declined           │
│    confirm your date."           │  │ CREW      declined           │
│ OWNER   "APPROVED: $4,200.       │  └──────────────────────────────┘
│    Prefers Mon 17, Wed 19.       │
│    Needs a confirmed date."      │
│ CREW    Full brief + their       │
│    preferred days + job link     │
└──────────────────────────────────┘
                 │
        ── crew checks their own schedule ──
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ④ CREW CONFIRMS THE DAY + START TIME            status: Scheduled   │
│    Pick a start time, then one tap on the customer's days — from    │
│    the CRM job page OR the contractor's own /job/<token> page (in   │
│    their language). THIS IS WHAT BOOKS THE JOB.                     │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Your project date and time are confirmed by our team:    │
│            Monday, August 17 at 9:00 AM. We look forward to it!     │
│            We'll text a reminder before we arrive."                 │
│ OWNER     JOB BOOKED + full brief                                   │
│ CREW      JOB BOOKED + full brief                                   │
│ CALENDAR  Event created, assigned contractor invited                │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⑤ DATE MOVES (any time after ④)                                     │
│    Same card, "Change date"                                         │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "your project with Raleigh Concrete Group has been moved  │
│            from: / Friday, August 29th at 1:30 PM / to: /           │
│            Saturday, August 30th at 2:30 PM" (each on its own line) │
│            (time-only changes on the same day notify too)           │
│ OWNER     DATE CHANGED + From/To blocks + brief                     │
│ CREW      DATE CHANGED + brief                                      │
│ CALENDAR  Updated                                                   │
│ ALSO      The 2-day reminder resets, the crew countdown resets, and │
│           any confirmation the customer gave is cleared.            │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⑥ THE RUN-UP (daily cron, ~10am ET)                                 │
├─────────────────────────────────────────────────────────────────────┤
│ CREW  3 days out │ full brief + "call Noah ASAP if you can't make   │
│       1 day out  │ it, or if anything about the schedule changes"   │
│       morning of │ Each stage is recorded so a re-run can't double  │
│                  │ text. Moving the date starts the run again.      │
│ ─────────────────┴───────────────────────────────────────────────── │
│ CUSTOMER  2 days out: "Please confirm your job on <day>: <link>"    │
│    ├─ confirms      → confirmed_at set. Nobody is texted.           │
│    └─ can't make it → OWNER + CREW: "couldn't confirm, reach out"   │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⑦ WORK DONE → ⑧ PAID                                                │
├─────────────────────────────────────────────────────────────────────┤
│ Mark completed   CUSTOMER "Thanks for your business" + review link  │
│                  OWNER    "Job completed by <crew>"                 │
│ Request payment  CUSTOMER payment instructions                      │
│ Mark paid        OWNER    "Paid: <name> ($4,200)"                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Why approval and scheduling are split

Previously, approving the quote also booked the day: the customer picked a date
on the quote page and it went straight onto the calendar. That committed the
crew to days nobody had checked, and the only way to fix a clash was a phone
call — which is where scheduling used to stall.

Now the customer **proposes** (up to 3 days, earliest 7 days out, each checked
against the one-job-per-day rule as they pick) and the crew **disposes**. The
contractor sees those days on their own job page — in their language — and
confirms one with a single tap; owners can do the same from the CRM.

Net effect: one text each way instead of a phone-tag loop, and the crew is never
committed to a day they haven't agreed to.

### Lead times, and who they apply to

| Date | Earliest | Who it binds |
|------|----------|--------------|
| In-person quote **visit** | 4 days out (`VISIT_LEAD_DAYS`) | The customer, on the request form |
| Preferred **install** days | 7 days out (`LEAD_TIME_DAYS`) | The customer, on the approval page |
| Confirming the **work day** | today | Nobody — you and the crew can book any day |

Both customer-facing limits are enforced on the server as well as in the date
picker, because `min` on an input is a convenience, not a rule. The crew's
picker deliberately has no floor: the lead time exists to stop a customer
booking something you can't staff, not to stop you agreeing to a rush job.

---

## Message formatting

Every message is built from lines. On a phone, a 300-character paragraph is a
grey block nobody reads to the end of, and the part that matters — a date, a
phone number, an address — is exactly the part that gets lost in it.

Two shapes are used:

**Labelled blocks**, where the data *is* the message (owner alerts, the crew's
reminders, the date-moved text):

```
Hi James,
your project with Raleigh Concrete Group has been moved from:

Friday, August 29th at 1:30 PM
to:
Saturday, August 30th at 2:30 PM

Sorry for the change, call or text us if that day doesn't work.
```

**One field per line**, for the customer brief embedded inside a longer crew
message. Full blocks there would push a reminder past four SMS segments without
making it any easier to read:

```
Customer: Jane Doe
Phone: (919) 555-1234
Service: Driveway replacement
Address: 123 Main St, Raleigh, NC
Scheduled: Monday, August 17th at 9:00 AM
```

Dates are always spelled out with the weekday and an ordinal ("Friday, August
29th"), and always carry the time when there is one. Every customer-facing
mention of an appointment goes through a single `dayAndTime()` helper, so the
time cannot silently drop out of one message but not another.

---

## Customer message count

At most **six** texts across an entire job:

| # | When | Message |
|---|------|---------|
| 1 | Request received | Acknowledgement |
| 2 | Quote sent | Their quote link |
| 3 | They approve | "We'll confirm your date shortly" |
| 4 | Crew confirms | "Booked for <day>" |
| 5 | 2 days before | Confirm link |
| 6 | Work done | Thanks + review link |

Plus payment instructions if you request payment, and one "date moved" message
per reschedule.

---

## Owner: new lead format

A new lead is usually read on a phone mid-task, so it's laid out in labelled
blocks rather than one run-on line:

```
New Quote Request for:
Jane Doe

Job Type:
Driveway replacement

Customer Phone:
(919) 555-1234

Address:
123 Main St, Raleigh NC

Details:
Cracked driveway, about 600 sq ft, would like it
replaced before the fall.

https://raleighconcrete.net/job/abc123
```

Address and Details are only included when the customer gave them. Details is
free text, so it's capped at 400 characters — an essay shouldn't turn one alert
into a ten-part text.

---

## Owner alerts

**You are texted for:** new lead · customer approved · customer declined · date
confirmed · date moved · customer couldn't confirm · job completed · paid.

**You are not texted for:** assigning a contractor · sending a quote · editing a
price, summary or notes · dragging a card between early pipeline columns ·
rotating links · requesting payment.

Owner alerts go to every active owner's saved number **plus** `OWNER_PHONE`,
minus whoever performed the action.

---

## Contractor messages

| Trigger | What they get |
|---------|---------------|
| Invited to the crew | One-time `/join/<token>` link to set up their own login. Single-use, expires in 7 days |
| Account created manually | Sign-in URL, username, temporary password |
| Password reset by owner | Same format, new temporary password |
| Assigned a job | Full brief: customer, phone, service, address, timing, job link, "sign in to open" |
| Customer approves | Same brief + the customer's preferred days + "confirm the day that works" |
| Date confirmed / moved | JOB BOOKED or DATE CHANGED + brief |
| **3 days / 1 day / morning of** | **JOB REMINDER + brief + "call Noah right away if you can't make it"** |
| Customer declines | Declined |
| Customer can't confirm | Reach out |

Every crew text carries the customer's phone and address inline, so they can act
on it without opening anything. The job link needs a CRM sign-in, and the text
says so up front.

The escalation number in the reminders comes from `OWNER_CALL_NUMBER`, falling
back to the main business line.

---

## One job page for the crew

A contractor has exactly one screen per job: **`/job/<token>`**, the same URL
their texts link to. It carries everything they can do — quote it, confirm the
day and time, mark it done — in their own language, built for a phone.

A contractor who lands on `/crm/quotes/<id>` is redirected there, and pipeline
cards link there for them. `/crm/quotes/<id>` is the owner's view. Previously
the same job looked like two different screens depending on how you reached it,
which is what made the job link and the pipeline feel like separate systems.

---

## Where this lives in the code

| Piece | File |
|-------|------|
| All message copy | `src/lib/crm/notify.ts` |
| Customer approves + picks days | `src/app/q/[token]/quote-actions.tsx` → `src/app/api/quote-response/route.ts` |
| Approval recorded, dates validated | `recordCustomerResponse` in `src/lib/crm/queries.ts` |
| Crew confirms / moves the day | `setJobDate` in `src/app/crm/quotes/[id]/actions.ts` → `confirmSchedule` in `queries.ts` |
| Scheduling UI (owner) | `src/app/crm/quotes/[id]/schedule-card.tsx` |
| Scheduling UI (crew) | `src/app/job/[token]/job-schedule.tsx` |
| Crew quotes a job | `src/app/job/[token]/job-quote.tsx` → the same `saveQuote` action |
| Customer + crew reminders | `src/app/api/cron/reminders/route.ts` |
| Address rule (form + API) | `src/lib/address.ts` |
| Owner recipient list | `ownerRecipients` in `notify.ts` |
| Test a real send | CRM → Settings → Text notifications |

Pipeline stages, lead times and the reminder schedule are constants in
`src/lib/crm/constants.ts` (`STATUSES`, `LEAD_TIME_DAYS`, `VISIT_LEAD_DAYS`,
`MAX_PREFERRED_DATES`, `CREW_REMINDER_DAYS`, `VISIT_TIME_SLOTS`).

Crew reminder tracking needs `supabase/crew-reminders.sql` to have been run.
