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
│            + "if we need to see it in person you asked for <slot>,  │
│              nothing is booked yet, we'll text to confirm"          │
│            (in-person requests instead confirm the visit day/time)  │
│ OWNER     Labelled block: name, job type, phone, address,           │
│            details, job link (see "Owner: new lead format" below)   │
│ CREW      Full brief — customer, phone, service, address, timing    │
│            (only if auto-assigned to your primary contractor)       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                 ── silence until you send a price, unless ──
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ①b ONLINE REQUEST NEEDS A LOOK                     status: unchanged│
│    Crew taps "Confirm this visit" on their job page. Optional —     │
│    most online jobs are priced from the photos and skip this.       │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Your free in-person quote is confirmed: <day> at <time>" │
│ OWNER     "QUOTE VISIT CONFIRMED" + who confirmed it + the brief    │
│ CREW      "QUOTE VISIT CONFIRMED" + when + brief + call-us-if-stuck │
│ The request becomes in-person, so it joins the calendar, gets a     │
│ Google invite, and starts consuming that day's visit capacity.      │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ② YOU SEND THE QUOTE                               status: Quoted   │
│    "Send Quote" on the job page (needs a price + description)       │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Your quote is ready: <link>"                             │
│ OWNER     "QUOTE SENT" — who sent it, customer, amount, now         │
│            waiting on them. Skipped if you sent it yourself.        │
│ CREW      "Your quote for <customer> has been sent" + wait for      │
│            them to answer. Only whoever pressed send.               │
│                                                                     │
│ If the customer's text FAILED, both messages say so instead —       │
│ "QUOTE TEXT FAILED … give them a call". A confident "sent" over a   │
│ text that bounced stops everyone chasing a customer who never       │
│ heard from us.                                                      │
│                                                                     │
│ It only sends once. A second Send is refused while the quote is     │
│ out and unanswered — unless they've replied, the last text failed,  │
│ or an owner deliberately resends.                                   │
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

### Every text is logged against the job

Sends are best-effort on purpose — a texting outage must never fail a customer's
quote submission — but "best-effort" used to mean "silent". A lead could land
with nobody notified, and the only trace was a line in the Vercel logs.

Every attempt now writes a row to `quote_messages` (`supabase/message-log.sql`),
including the ones that never reach the provider: an unparseable number, an
empty message, or an owner alert with no owner phone configured. Those are the
failures worth catching, because from the outside they look exactly like
success. The log appears on the job page above the activity log — the activity
log says what happened, the message log says whether anyone was told.

`Accepted` means your SMS provider took the message. Carrier delivery is a
separate step nobody tells us about, so that badge is the line between "our
problem" and "not our problem", which is the question actually being asked. A
failed row carries the provider's own error text rather than a generic
"couldn't send".

Sends carry their context through `SmsLog { quoteId, kind, role }`, so adding a
notification means passing that object to `sendSms` and adding a label to
`MESSAGE_LABELS` in `src/lib/crm/messages.ts`. A kind with no label falls back
to its raw key rather than rendering blank.

### What drains the held-text queue

A text held by quiet hours (a customer, 7pm-8am) or by spacing (anyone, a few
minutes) is a row in `quote_messages` with a `send_after` on it. Nothing in a
serverless app sits around waiting for 8am, so the row leaves on the next thing
that happens to drain the queue:

| Drain | When |
|-------|------|
| `/api/cron/reminders` | 13:00 UTC - 8am EST, **9am EDT** |
| `/api/cron/visit-reminders` | 22:00 UTC - 5pm EST, **6pm EDT** |
| Any outbound text, on its way past | Whenever one is sent |
| Opening the CRM | Whenever staff use the app |
| `/api/cron/drain` | Only if wired up in `vercel.json` - see that file |

Two consequences worth knowing. First, **8am is a floor, not a promise**: in
summer the earliest scheduled drain is 9am, so a text raised at 6:30am says "goes
out at 8:00 AM" and actually leaves when something drains next. Second, the crons
are not a safety net on their own - a wrong or missing `CRON_SECRET` answers them
with a 401, which looks exactly like nothing happening. That is why the CRM
itself drains, and why the queue is now reported rather than assumed.

**When a held text does not arrive**, in order:

1. **CRM → Settings → Time & quiet hours → Held texts.** `Empty` means the queue
   is doing its job and the problem is elsewhere. `N overdue` means the drain is
   not running or the sending is failing. `Can't read the queue` means the
   database is rejecting the query, which is almost always a migration.
2. **The job page's message log** has the provider's own error on the row.
3. **`supabase/audit.sql`** lists any migration that has not been run. A missing
   column on `quote_messages` stops the queue outright. Its X1 section lists
   texts that are due and still sitting there.

A stalled queue does not lose texts, it **accumulates** them - so before fixing
the cause, run `supabase/queue-backlog.sql` and see what is about to go out.
This morning's quote should fly; last Tuesday's should not, and the ordinary
Cancel button will not touch it because that only offers itself on a text whose
hour has not come yet. Part 2 of that file retires the stale ones.

A failed send is put back on the queue and retried up to three times, but only
when the provider actually refused it. If the call never completed we cannot
tell whether it arrived, so it is left alone rather than risking a second copy.

### Send now

Any queued text can be sent immediately, by the owner from the job page's
**Texts sent** log or by the assigned contractor from **Waiting to send** on
their own `/job/<token>` page. It overrides quiet hours, deliberately.

The rule is a courtesy and the person whose money is on the other end of it has
to be able to step over it: a contractor correcting a price at 6:30am is racing
the customer's decision, not their bedtime, and ninety minutes of a wrong figure
sitting in a thread is how a job gets accepted at the old number. Inside quiet
hours the button says what it is about to do rather than hiding it, and the job's
activity log records that somebody chose not to wait.

It is offered on **any** held text, including one already past its hour - unlike
Cancel, which hides itself at that point. The asymmetry is about what losing a
race to the drain costs: a late cancel marks a text cancelled that is already on
somebody's phone, so the log ends up lying, while a late send just finds the row
already claimed and says so. Both go through the same claim the drain uses, so
the customer gets exactly one text either way.

### Lead times, and who they apply to

| Date | Earliest | Who it binds |
|------|----------|--------------|
| Quote **visit** (either type) | 4 days out (`VISIT_LEAD_DAYS`) | The customer, on the request form |
| Preferred **install** days | 7 days out (`LEAD_TIME_DAYS`) | The customer, on the approval page |
| Confirming the **work day** | today | Nobody — you and the crew can book any day |
| Confirming a **quote visit** | today | Nobody — the crew can confirm any open day |

Both customer-facing limits are enforced on the server as well as in the date
picker, because `min` on an input is a convenience, not a rule. The crew's
picker deliberately has no floor: the lead time exists to stop a customer
booking something you can't staff, not to stop you agreeing to a rush job.

### One contractor, one place at a time

The per-day caps (`MAX_JOBS_PER_DAY`, `MAX_VISITS_PER_DAY`) are about the
business. They say nothing about whether the *person* is free, and five visits
a day is plenty of room to book the same crew twice in one slot.

Every path that commits a date now checks the assigned contractor first:

| Booking | Blocked by |
|---------|-----------|
| A work day | **Anything** else that contractor has that date — another job, or a quote visit |
| A quote visit | A job that day (they're on site all day), or another visit **at the same time** |

A work day blocks the whole date because a pour is a full day on site; a visit
is about an hour, so visits only clash with each other at the same slot. An
online request's `visit_date` never blocks anything — it's a slot the customer
offered, not an appointment anyone agreed to.

Enforced in `confirmSchedule`, `rescheduleVisit`, `confirmVisit` and the public
form, so it holds whether the date comes from a customer, the crew's job page,
the CRM, or a drag on the calendar. The public quote form also greys out slots
the crew already has, but that is a courtesy, not the guard: two people can be
on the form at once, so the server re-checks on submit.

Staff-facing screens name the customer already in that slot (`conflictMessage`),
because that is what makes the clash resolvable. The public endpoint deliberately
does not — "already with Jane Smith at 10am" would hand a stranger a customer's
name and schedule.

With no primary contractor set, there is nobody to double-book and only the
per-day caps apply.

### The date on an online request means something different

Both quote types ask for a day and a time, and `quote_type` is the only thing
that says which of two meanings `visit_date` carries:

| `quote_type` | What `visit_date` is | Who is expected to be there |
|--------------|----------------------|-----------------------------|
| `inperson` | A booked visit, confirmed the moment it's submitted | The crew |
| `online` | A slot the customer offered in case photos aren't enough | Nobody, yet |

Reading the column without checking the type is what once texted the owner and
the crew an appointment for a customer who had only been told "we'll be in
touch". Nothing reads it raw now: `visitDateOf()` returns a booked appointment
and `requestedVisitOf()` returns an unconfirmed offer, both in
`src/lib/crm/constants.ts`, and the calendar, Google invites, crew reminders and
the job-page headline are all built on the first of those.

An online request that turns out to be too big to price from photos gets
confirmed by the crew on their job page (**Need to see it in person?**). That
runs `confirmVisit`, which flips `quote_type` to `inperson` — one column change
that switches on every downstream surface at once — and texts the customer, the
assigned contractor and the owner the same day, time and address. An online
request's slot never consumes in-person visit capacity until it's confirmed
(`countVisitsOn` excludes online rows).

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
| The held-text queue | `flushHeldMessages` in `src/lib/crm/notify.ts` |
| Queue health readout | `queueHealth` in `src/lib/crm/queries.ts` |
| Send a queued text now | `sendHeldMessageNow` in `notify.ts`, `sendHeldTextNow` in `crm/quotes/[id]/actions.ts` |
| Address rule (form + API) | `src/lib/address.ts` |
| Owner recipient list | `ownerRecipients` in `notify.ts` |
| Test a real send | CRM → Settings → Text notifications |

Pipeline stages, lead times and the reminder schedule are constants in
`src/lib/crm/constants.ts` (`STATUSES`, `LEAD_TIME_DAYS`, `VISIT_LEAD_DAYS`,
`MAX_PREFERRED_DATES`, `CREW_REMINDER_DAYS`, `VISIT_TIME_SLOTS`).

Crew reminder tracking needs `supabase/crew-reminders.sql` to have been run.
