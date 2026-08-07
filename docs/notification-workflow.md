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

---

## The flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ ① LEAD ARRIVES                                        status: New   │
│    Customer submits the quote form                                  │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Thanks for reaching out. We're reviewing and will text   │
│            your price shortly."                                     │
│            (in-person requests instead confirm the visit day/time)  │
│ OWNER     New quote: name, service, phone, job link                 │
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
│ ④ CREW CONFIRMS THE DAY                         status: Scheduled   │
│    Assigned contractor OR an owner picks one of the customer's      │
│    days (one click) or any other day. THIS IS WHAT BOOKS THE JOB.   │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Good news — your project is booked for Mon, Aug 17.      │
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
│ CUSTOMER  "Your project has been moved from Mon Aug 17 to Thu Aug   │
│            20. Sorry for the change — call us if that doesn't work."│
│ OWNER     DATE CHANGED (Aug 17 → Aug 20) + brief                    │
│ CREW      DATE CHANGED + brief                                      │
│ CALENDAR  Updated                                                   │
│ ALSO      The 2-day reminder resets, and any confirmation the       │
│           customer already gave is cleared — they re-confirm.       │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ⑥ TWO DAYS BEFORE (daily cron)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER  "Please confirm your job on <day>: <link>"                │
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

Now the customer **proposes** (up to 3 days, earliest ~11 days out, each checked
against the one-job-per-day rule as they pick) and the crew **disposes**. The
contractor sees those days in the CRM and confirms one with a single click.

Net effect: one text each way instead of a phone-tag loop, and the crew is never
committed to a day they haven't agreed to.

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
| Customer declines | Declined |
| Customer can't confirm | Reach out |

Every crew text carries the customer's phone and address inline, so they can act
on it without opening anything. The job link needs a CRM sign-in, and the text
says so up front.

---

## Where this lives in the code

| Piece | File |
|-------|------|
| All message copy | `src/lib/crm/notify.ts` |
| Customer approves + picks days | `src/app/q/[token]/quote-actions.tsx` → `src/app/api/quote-response/route.ts` |
| Approval recorded, dates validated | `recordCustomerResponse` in `src/lib/crm/queries.ts` |
| Crew confirms / moves the day | `setJobDate` in `src/app/crm/quotes/[id]/actions.ts` → `confirmSchedule` in `queries.ts` |
| Scheduling UI | `src/app/crm/quotes/[id]/schedule-card.tsx` |
| 2-day reminder | `src/app/api/cron/reminders/route.ts` |
| Owner recipient list | `ownerRecipients` in `notify.ts` |
| Test a real send | CRM → Settings → Text notifications |

Pipeline stages and the lead time are constants in `src/lib/crm/constants.ts`
(`STATUSES`, `LEAD_TIME_DAYS`, `MAX_PREFERRED_DATES`).
