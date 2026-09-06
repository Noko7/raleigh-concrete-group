# Raleigh Concrete Group - Website

Multi-city local services site in the **exact format of mammothcoat.com** (Next.js App Router +
Tailwind v4), rebranded for Raleigh Concrete Group: homepage location picker → per-city pages with
**draggable before/after sliders**, an **auto-rotating gallery carousel**, services, process,
reviews, and a quote form.

## Structure (mirrors the mammoth repo)

```
src/
  app/
    layout.tsx          # fonts (Bebas Neue + Sora), site metadata
    globals.css         # brand theme + all component styles (amber recolor)
    page.tsx            # homepage: hero + "Select Your Location"
    [location]/page.tsx # static per-city route (generateStaticParams)
  components/
    site-header.tsx        # sticky header, location pills, mobile drawer
    before-after-slider.tsx# draggable before/after comparison
    gallery-carousel.tsx   # auto-rotating photo carousel
    location-page.tsx      # the per-city page template
    quote-form.tsx         # quote form → saves to Supabase
  lib/
    site-data.ts        # ALL content: services, locations, gallery, reviews
public/images/          # real project photos + logos
supabase/schema.sql     # run once to create the quote_requests table
```

## Edit content
Everything lives in `src/lib/site-data.ts`:
- **`businessName`, `phoneDisplay`, `phoneHref`, `textHref`** - your NAP.
- **`services`** - the service catalog. Each entry has a `slug`, `name`, `navLabel`,
  `group` (`core` shows in the nav + homepage; `concrete`/`hardscaping` show in the full menu),
  `blurb`, `intro`, `bullets`, `image`, and optional `beforeAfter`. Adding one auto-creates a
  page at `/services/<slug>`.
- **`locations`** - city pages live at `/<city>` (linked from the footer, not the main nav).
- **`galleryImages`**, **`sharedBeforeAfter`**, **`testimonials`**.

## Before launch - final touches
1. **Phone** - set to `(919) 873-3919` in `site-data.ts`. ✅
2. **Photos** - real project photos + logos are in `public/images/`. ✅ (They're large PNGs;
   Vercel's image optimization handles resizing automatically, but you can compress them for
   faster builds.)
3. **Domain** - `https://www.raleighconcrete.net` in `src/app/layout.tsx` (`metadataBase`).
4. **Reviews** - swap the testimonials for real Google reviews (never fabricate).

## Quote funnel → Supabase
Clicking any **Get Free Quote** button opens a multi-step modal (`src/components/quote-modal.tsx`):

1. **Choose a path** - Online quote (fastest) or In-person visit.
2. **Address** - with free autocomplete (Photon/OpenStreetMap, no API key needed), biased to Raleigh.
3a. **Online:** upload photos/video (saved to Supabase Storage) so we can quote from satellite + pics.
3b. **In-person:** pick a day and an hourly slot from the crew's own working hours.
4. **Contact** - name, phone, email → saved as a lead.

Everything is captured early and the form is split into small steps, which converts far better than a
single long form. Submissions save to Supabase via its REST API (no SDK installed). Runs in
**demo mode** (shows success, saves nothing) until the keys below are set.

**One-time setup:**
1. In Supabase → **SQL Editor**, paste & run `supabase/schema.sql`. This creates the
   `quote_requests` table, the `quote-uploads` storage bucket, and policies that let the public site
   insert leads + upload files but not read them.
2. In Supabase → **Project Settings → API**, copy the **Project URL** and **anon public** key.
3. In Vercel → **Settings → Environment Variables**, make sure these two exist (the Supabase
   integration may have added them already - confirm the `NEXT_PUBLIC_` prefix, the browser needs it):
   - `NEXT_PUBLIC_SUPABASE_URL` = your Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon public key
4. Redeploy. Leads land in **Table Editor → quote_requests**; uploaded photos in
   **Storage → quote-uploads** (their URLs are saved in the lead's `file_urls`).

To swap the address autocomplete to Google Places later, replace `AddressAutocomplete` in
`quote-modal.tsx` (needs a Google Maps API key + billing). Photon is free and zero-config.

## CRM (crm.raleighconcrete.net)
A login-protected back office for managing quotes, plus two public token links you text out.
All of it runs over Supabase's REST/Auth APIs (no extra packages).

**What's included**
- **Login + roles** (`/crm/login`): owners see everything; contractors see only jobs assigned to them (enforced by Postgres Row-Level Security).
- **Quotes dashboard** (`/crm`): filter by status / assignee / search; pipeline `New → Quoted → Booked → Confirmed → Complete` (plus `Lost`).
- **Quote detail** (`/crm/quotes/[id]`): customer info, **private photos via short-lived signed URLs**, status + contractor assignment, quote amount + customer-facing summary, internal notes, activity log, copyable share links, and a **Mark complete + paid** button.
- **Contractors** (`/crm/contractors`, owner only): **text an invite** and let them set up their own login, edit their details, reset a password, deactivate/reactivate, or delete.
- **Settings** (`/crm/settings`): your name + alert number; owners also pick the **primary contractor** that new quotes auto-assign to.
- **Customers** (`/crm/customers`): quotes auto-grouped by phone/email with won-value totals.
- **Calendar** (`/crm/calendar`): a month view of booked jobs (`scheduled_date`) and in-person quote visits (`visit_date`). Click any item to open the deal. Owners can connect Google Calendar here.
- **Customer quote link** (`https://raleighconcrete.net/q/<public_token>`): branded, no-login page showing the price + summary; the customer accepts (and schedules) or declines right there.
- **Job confirmation link** (`https://raleighconcrete.net/confirm/<public_token>`): sent in the 2-day reminder so the customer can confirm or ask to reschedule.
- **Contractor job link** (`https://raleighconcrete.net/job/<job_token>`): the photos, address (Maps link) and customer contact. Requires a CRM sign-in, and a contractor only sees jobs assigned to them.

**Deal lifecycle + automatic texts**
The customer hears from us at most six times, and only when something they care
about actually changes. Nothing internal - assignments, price edits, notes,
status drags - ever texts the customer.

1. **New** - quote arrives, auto-assigned to your primary contractor. Owner + contractor get the full brief; the customer gets an acknowledgement (in-person includes their visit date/time).
2. You set a price + description and hit **Send Quote** → customer gets their quote link (**Quoted**).
3. Customer approves and picks **up to 3 days that suit them, each with a start time** → they're told we'll confirm shortly; owner + contractor are told it **needs a date**, with the hours they asked for (**Needs scheduling**). Declining notifies owner + contractor (**Lost**).
4. The assigned contractor (or an owner) confirms one of those days on the job page → **this is what books it**: the customer is texted their date, the crew gets the brief, and it lands on Google Calendar (**Scheduled**).
5. Changing that date later texts the customer that it moved, re-notifies the crew, and updates the calendar. The 2-day reminder resets so they still get one.
6. Two days before, a daily cron texts the customer a confirm link. "Need to reschedule" pings owner + contractor.
7. **Mark completed** → customer gets a thank-you + Google review link. **Request payment** → payment instructions. **Mark paid** closes it out.

Why the split at step 3/4: letting the customer book a day outright committed
the crew to dates nobody had checked. They now propose, the crew disposes - so
scheduling is settled in one text each way instead of a phone-tag loop.

**Owner alerts** are limited to the moments worth interrupting you: new lead,
approved, declined, date confirmed or moved, can't-confirm, completed, and paid.

**Nobody is texted about something they just did.** This is the one rule the
staff-facing texts run on, and it is enforced at the send, not per message: the
acting person's number is passed to every internal notification and dropped from
its recipients. It matters most for the crew, because the actions that generate
the most internal texts - sending a quote, confirming a work day, confirming or
moving a visit, cancelling one - are exactly the ones a contractor performs
themselves on their own job page. Before this, each of those texted them back a
summary of the button they had just pressed, on top of the screen already
telling them, and an owner doing the same thing from the CRM got their own alert
returned to them.

The screen is the receipt for your own action; a text is for people who weren't
there. So:
- **Sending a quote** texts the office and nobody else. Whoever pressed Send
  sees the result where they pressed it - the CRM banner and the crew's job card
  both name the number it went to, and say when a text held by quiet hours goes
  out.
- **Confirming or moving a work day or a visit** texts the customer, the office,
  and the assigned contractor *if they weren't the one who did it*. When the
  office books it, the crew still hear. When the crew book it themselves, they
  don't get told what they just booked.
- **Cancelling** is the same, and the crew still hear on every path regardless of
  whether the customer is texted - that checkbox was only ever about the customer.
- An unassigned job tells no contractor rather than falling back to whoever is
  clicking, which used to mean the office texting itself.

**One-time setup**
1. Run `supabase/schema.sql` first (if you haven't), then `supabase/crm.sql`, then `supabase/agreements.sql`, `supabase/quote-options.sql`, `supabase/scheduling.sql`, `supabase/scheduled-time.sql`, `supabase/crew-reminders.sql`, `supabase/invites.sql`, `supabase/invite-tracking.sql`, `supabase/locale.sql` and `supabase/appointments.sql` in the SQL Editor.

   `supabase/crew-reminders.sql` also (re)adds `scheduled_time`, so running just
   that one file is enough to fix "Could not save that date" when confirming a
   work day. Every file is safe to re-run.
2. Confirm Vercel env vars exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the CRM needs the service-role key).
3. Create your owner login: Supabase → **Authentication → Users → Add user** (email + password), then run the promote snippet at the bottom of `supabase/crm.sql`.
4. **Subdomain:** in Vercel → Project → **Domains**, add `crm.raleighconcrete.net`; in your DNS registrar add the **CNAME** Vercel shows (typically `crm` → `cname.vercel-dns.com`). Routing to the CRM is already wired in `src/middleware.ts`. (Until DNS is live you can also reach it at `raleighconcrete.net/crm`.)

**Hook your text automation up to the links**
Your Supabase automation already fires on new `quote_requests` rows. Each row now also has
`public_token` and `job_token` columns - build the URLs in your message template:
- Contractor text (with photos): `https://raleighconcrete.net/job/{{ job_token }}`
- Customer text (their quote): `https://raleighconcrete.net/q/{{ public_token }}`

**English / Spanish**
Every CRM screen a contractor can reach renders in **English or Spanish**, per person. They choose
on the onboarding form before their account exists, and can change it any time under **Settings →
Language**. The choice lives on their staff row, so it follows them to any device.
- The **login screen** has English/Español links, since there's no account to read a preference from
  yet (`/crm/login?lang=es`).
- Translations live in `src/lib/crm/i18n.ts`. There's no i18n package - the Spanish dictionary is
  typed as `typeof en`, so **a missing translation fails the build** rather than silently showing
  English to a Spanish speaker.
- Owner-only admin screens (Contractors, Security, Archived) are English only - no contractor sees
  them. Customer-facing pages are unchanged.

**Adding a contractor**
Preferred way: **CRM → Contractors → Invite a contractor**. Enter their phone number and they get a
one-time link to `/join/<token>` where they fill in their own name and email and choose their own
password. Nothing is created until they finish, so a mistyped number just expires.
- The link is **single-use**, expires in **7 days**, and can be cancelled from the Signups list.
- The **Signups** table tracks how far each invite got: *Sent, not opened* → *Opened, not finished* →
  *Account created*. "Opened, not finished" is the one worth chasing - they tapped the link and got
  stuck. Repeat opens are counted, so `·3×` means they've tried three times.
- Their alert number comes from the invite you sent, not the form, so it can't be pointed elsewhere.
- The invite is valid even if the text fails - the link is always shown in the CRM so you can pass it
  on another way.
- Manual creation (you set a temp password) is still there under "Or add a contractor manually".

**Contractors sign in with their own email** - gmail, icloud, whatever they already use. No
allowlist applies to them. What authorises a contractor is having an **active contractor staff row**,
which only an owner can produce: the signup trigger creates staff rows *inactive*, so a stray
Supabase signup still can't get in on its own.

`CRM_ALLOWED_EMAILS` / `CRM_ALLOWED_DOMAINS` still gate the **owner** role, which is the one that can
manage staff and see every customer. With neither set, the fallback for owners is your own site
domain.

**Deleting** is permanent and asks you to type the contractor's name. Their agreements go with them
and any assigned jobs become unassigned. **Deactivate** is the reversible option and is usually what
you want.

**Agreements (DocuSeal)**
Signing itself happens in **DocuSeal**, which you manage separately: you build the template there,
send it, and DocuSeal emails the signer and hosts the signing page. The CRM is the *record* of it -
**CRM → Agreements** (`/crm/agreements`) tracks status, and stores the signed file.
- **Contractor agreements** - one onboarding doc per crew member, added from **CRM → Contractors**.
- **Customer agreements** - one per job, added from that job's page.
- Statuses: Not sent → Awaiting signature → Signed (or Declined / Void). You set these yourself,
  since DocuSeal isn't wired into the app.
- Files live in a **private** `agreements` storage bucket and are only ever served through
  `/crm/api/agreement`, which scopes access with RLS: an owner sees everything, a contractor sees
  only their own agreement and jobs assigned to them.
- Requires `supabase/agreements.sql` (step 1 above). No new env vars, no npm packages.
- Note: a customer with no email on file can't be emailed by DocuSeal - the quote form makes email
  optional, so check the job page before sending.

**Built-in SMS alerts (owner + contractor)**
The app texts you and your crew automatically: a **new lead** texts the owner; **assigning** a job
texts that contractor their job link; and when a contractor advances a job the owner gets a heads-up.
Add these Vercel env vars (no SQL needed):
- `OWNER_PHONE` - your number for owner alerts (e.g. `+19198733919`).
- **Quo (OpenPhone)** - the default when `QUO_API_KEY` is set:
  - `QUO_API_KEY` - from Quo → Settings → API (used as the `Authorization` header).
  - `QUO_FROM` - your Quo number in E.164 (e.g. `+19198733919`).
  - `QUO_USER_ID` *(optional)* - send as a specific workspace member.
  - Note: Quo requires completed **US carrier (A2P) registration** to text US numbers.
- `SMS_PROVIDER` *(optional override)* - `quo`, `twilio`, or `custom`.
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- Custom provider: `SMS_API_URL`, `SMS_API_KEY`, `SMS_FROM` (POSTs `{ to, from, message }` with a `Bearer` key).

Each person sets their own alert number under **CRM → Settings** (`/crm/settings`). Owner alerts go to every active owner's number **plus** `OWNER_PHONE`; contractor alerts use that contractor's saved number. The person who performs an action isn't texted about their own click. SMS is best-effort - a texting outage never blocks a quote from saving.

**Testing texts (owner only)**
**CRM → Settings** has a **Text notifications** panel that shows the active provider, the sending
number, any missing env vars, and exactly which numbers an owner alert would reach. The **Send test
text** button sends one real message and prints the provider's raw response, which is how you tell
these apart:
- `401` - bad or missing `QUO_API_KEY`.
- `400` with *A2P Registration Not Approved* - the key is fine, but the carrier hasn't approved the
  brand/campaign yet. Nothing in the app can work around this.
- `403` *Not Phone Number User* - `QUO_FROM` isn't a number your `QUO_USER_ID` can send from. Clear
  `QUO_USER_ID` to default to the number's owner.
- **Accepted** but no text arrives - the provider took it; the hold-up is carrier delivery.

`QUO_FROM` must be E.164 (`+19198733919`) or a Quo phone ID (`PN…`). Leave the number blank in the
test panel to text every owner number at once.

Customer-facing text settings:
- `OWNER_NAME` *(optional)* - first name used to introduce the business in the **first** text a customer gets (default `Noah`), e.g. "this is Noah with Raleigh Concrete Group". Every later message speaks as the business, so a name here doesn't tie the whole thread to one person.
- `GOOGLE_REVIEW_URL` *(optional)* - your Google review link; included in the post-job thank-you text. If unset, the thank-you still sends without a link.

**Daily reminders (Vercel Cron)**
Two daily crons, both declared in `vercel.json` and both free on the Hobby plan (it allows up to two cron jobs, each once a day). Both share the same `CRON_SECRET` env var in Vercel - sent as a Bearer token, and the endpoints reject anything else.

- `/api/cron/reminders` (14:00 UTC, ~10am ET) - flushes anything quiet hours held overnight, then four jobs: the 2-day customer confirmation text for a booked job; the crew countdown (3 days out, day before, morning of); one text to each assigned contractor listing **all** of their leads nobody has quoted 12+ hours after they came in (and one to the owner spanning everybody, including the unassigned pile); and a follow-up text to a customer who hasn't accepted or declined a sent quote within 48 hours. Confirming a job flips it to **Confirmed**; "need to reschedule" texts the owner + contractor.
- `/api/cron/visit-reminders` (22:00 UTC, ~6pm ET) - kept separate because it needs an evening run time; also flushes the held queue on its way past: texts both the customer and the assigned contractor (with the address) about tomorrow's in-person quote visit.

Since both crons only run once a day, a 12h or 48h threshold can be noticed up to ~24h late - an acceptable tradeoff for staying on the free plan.

**Reminders arrive one at a time, not all at once**
A daily cron does all of its thinking in one second, so everything it worked out
about one contractor used to land on their phone in that same second. A crew
member with two jobs starting this week and three untouched leads got five texts
at 10:00:03, which is read as one interruption and answered like one: they skim
the last and lose the other four.

Each person's texts from a single run now get slots, 15 minutes apart. **The
first is never delayed** - whatever a run has to tell somebody, the most urgent
thing reaches them exactly as fast as it always did, and only the pile behind it
is spread out. Slots are per person, so two contractors never wait on each
other. Set `REMINDER_SPACING_MINUTES` (default `15`) to change the gap, or `0`
to go back to sending everything at once.

Which reminder gets the un-delayed slot is decided by how soon it matters. The
crew countdown is sent **soonest job first** - the morning-of text goes now, the
day-before queues behind it, the 3-days-out behind that - and the stale-lead
nudge queues last, because "five leads are going cold" is the least
time-critical thing in the run.

Spacing reuses the quiet-hours queue: a spaced text is a `quote_messages` row
with a `send_after` on it, and it shows in the job's **Texts sent** log as
"Queued for 10:15 AM" rather than as a failure. The activity log says the same.
Quiet hours is now checked per row rather than being a reason to abandon the
whole flush, since it is a rule about customers and the crew get everything at
any hour.

**The catch, and the fix.** Nothing in a serverless app sits around waiting to
send the 10:15 text. The queue drains on the way past: both daily crons on their
way in, and every text sent during business hours. So on a busy day a spaced
reminder goes out close to its slot, and on a quiet morning it can wait for the
6pm cron. That is fine for a 3-days-out notice and poor for anything sharper,
which is exactly why the first text is never spaced.

To make the spacing exact, add a third cron that drains the queue - the route
already exists at `/api/cron/drain` (same `CRON_SECRET`, inert until it is
scheduled):

```json
{ "path": "/api/cron/drain", "schedule": "*/15 * * * *" }
```

Vercel's Hobby plan allows **two** cron jobs, each once a day, and both slots
are taken, so this needs a plan that allows a third and a schedule more often
than daily. Without it, everything above still works - the spacing just resolves
against the coarser drain the two daily crons already provide.

**One text, not six.** The stale-lead nudge used to send one text per lead, so a contractor who was off yesterday came back to six near-identical alerts and read none of them. It is now a single message per person per run listing every lead of theirs that has gone quiet - the first six spelled out, the rest as a count pointing at the CRM. A single stale lead still gets the fuller one-lead text it always had. The owner's copy spans every contractor and labels each entry with whose it is, so the unassigned pile finally has somewhere to be reported. Each job still records its own `stale_lead_reminded` event, so the per-job trace survives the batching.

The two nudges only chase work from the last **14 days** (`REMINDER_MAX_AGE_DAYS` in `src/lib/crm/queries.ts`). That keeps them off stale pipeline nobody intends to work, and - because every existing row counts as un-reminded the first time this runs - stops the first cron after deploy texting every historical lead and old unanswered quote at once.

Run `supabase/hourly-reminders.sql` before deploying this - it adds the tracking columns (`stale_lead_reminded_at`, `visit_reminder_sent_at`, `visit_crew_reminded_at`, `quote_followup_sent_at`) each new job uses to avoid sending the same reminder twice. Moving or cancelling a visit clears its two markers, so the new day gets its own reminders.

**Quiet hours: no CUSTOMER texts 7pm-8am**
Quiet hours are a courtesy to customers, not a shift pattern. A text to a customer raised between 7pm and 8am Eastern is not sent and not dropped - it is written to the message log with a `send_after` on it and delivered the next morning, so an 11pm booking still texts them, at 8am. Run `supabase/quiet-hours.sql` to add the two columns this needs (`send_after`, `sent_at`).

**You and the crew get everything, any hour.** Lead alerts, crew reminders, assignment texts and contractor logins are never held - you are on the job and the news is the point. The gate keys off the send's `role`: `customer` waits, `owner` and `crew` don't, and a send with no message-log entry at all (a contractor's login text, the Settings test) is staff-facing by definition and goes straight out.

The queue drains from three places, because a serverless app has nothing sitting around to wake up at 8am: both daily crons flush it first thing, and so does any text sent during business hours. In practice a held message goes out on the first activity after 8am, and the 10am cron is the floor if the morning is quiet. If you want it delivered at 8:00 exactly, that is a third cron (`/api/cron/reminders` at `0 12 * * *`) - Vercel's Hobby plan allows two, so it needs a plan that allows three.

One customer text ignores quiet hours: **the quote-request receipt**. They pressed the button seconds ago and are looking at a page that says we'll text them; holding that until 8am reads as the form having failed, which is how somebody at 10pm fills it in twice or calls the next contractor. Nothing that arrives out of the blue belongs in that category. The exception is `{ force: true }` on `sendSms`/`sendSmsResult`, so grepping for it shows the whole list - one call site.

A held message shows in the job's **Texts sent** log as "Waiting until 8:00 AM" rather than as a failure, and every screen that reports a send says so in its own words: the CRM quote banner, the contractor invite and password notes, and the crew's own job card after they send a quote ("Saved. Their text is scheduled for 8:00 AM"). A contractor quoting a job at 9pm is told the quote is saved and when it goes out - being told it failed is how somebody sends it twice, or spends the evening believing the job is stalled. The owner's copy says the same: `QUOTE SENT, QUEUED`, not `QUOTE TEXT FAILED`.

**Time is Eastern, everywhere**
`src/lib/crm/clock.ts` owns every reading of the clock: `now()`, today's date, day arithmetic, quiet hours. Vercel runs in UTC and phones are set to whatever their owners set them to, so anything asking "what day is it" or printing a timestamp goes through there and comes back in `America/New_York` - Eastern, which is EST in winter and EDT in summer, not a pinned -05:00 that would be an hour out all summer.

Time itself is the host clock, not an NTP query: serverless functions get outbound TCP only (NTP is UDP/123), and Vercel's AWS instances are already disciplined by Amazon's own time service, which is steadier than a public pool server reached over the internet. Settings → **Time & quiet hours** shows the current Raleigh time, whether texts are sending right now, and a drift check against a public HTTPS host's `Date` header as a second opinion.

> If you also send texts from a Make.com scenario, disable that scenario (or the SMS step) to avoid sending duplicate messages, since the app now texts directly through Quo.

**What a customer text never contains**
The price. A figure in a text has no scope beside it, gets forwarded and shopped around on its own, and the customer already has a quote page built to explain it - so every customer-facing message carries the link instead. `usd()` in `src/lib/crm/notify.ts` is for `role: "owner"` and `role: "crew"` messages only; check the role on the send before using it. Em dashes are stripped from every outbound text by `noEmDash()` (`src/lib/crm/constants.ts`), applied centrally in `sendSmsResult` so copy assembled from owner-typed content is covered too.

**Quotes: five sections, seven days**
Every quote answers Scope, Permits, Demolition and prep, Pour and finish, and Clean up. All five must say something before it can be sent, but "Not applicable" is a valid answer and each field has a one-tap button for it. Quotes written before this change fall back to their old free-text summary.

A sent quote link is good for `QUOTE_TTL_DAYS` (7) days from the last send. Re-sending re-stamps the clock, which is how an expired quote is revived. Expiry only applies while the customer still has a decision to make - once they've accepted, the page is their record of the job and the payment text links back to it.

**Quotes with options: one quote, several answers**
A quote can be a single price, or a list of **line items** the customer answers one at a time. The
customer who wants a patio and asks "what would the sidewalk cost while you're here?" gets both
prices on one page and takes either, both, or neither - and the total is whatever they picked.
Nothing changes for a quote with no line items: it stays exactly the single-price quote it was.

- **Two kinds of item.** *Part of the job* is shown with its price but can't be dropped, and *their
  choice* is an extra the customer says yes or no to. Without that split a customer could decline
  the driveway and accept the $800 apron extension that only exists because of it.
- **Nothing is pre-ticked.** Each optional item starts unanswered and **Approve** stays disabled
  until every one has a yes or no against it. An untouched box is somebody who scrolled past it, not
  a decision, and billing either way from silence is where a dispute starts. Saying no to everything
  points them at Decline rather than approving a $0 job.
- **The price follows the answers.** While the quote is out, `quote_amount` is the all-in figure. The
  moment they answer it becomes what they actually bought, so the owner's texts, the payment request
  and the customer's own page all keep reading the one column they always read. The $150 save credit
  comes off the selected total, not the all-in one.
- **Each item keeps its own answer.** `quote_options.customer_response` is stamped per row, so
  "what did they agree to" survives any later edit to the quote, and the crew reads it off their job
  page as **What they approved** before they load the truck.
- **Built in both places.** The builder is on the CRM quote editor and on the crew's own
  `/job/<token>` page, in English and Spanish - so the crew standing in the back yard being asked
  about the sidewalk can answer it there instead of over the phone the next day.
- **Locked once answered.** After the customer responds the items become a read-only record with
  each answer beside it. The server refuses to rewrite them even if a stale form posts them.
- Up to **12** line items per quote. The five sections (Scope, Permits, Demolition and prep, Pour and
  finish, Clean up) still cover the job as a whole and are still required to send; each item's own
  description covers what is specific to it.

Run `supabase/quote-options.sql` for this (the `quote_options` table plus its RLS, scoped exactly like
the job itself: owners see everything, a contractor sees the jobs assigned to them). Safe to re-run.
Until it is run, quoting still works - the app treats a missing table as "this quote has no line
items" - and the builder says which file to run if a save is attempted.

**Quote visits: back to back, an hour apart, per contractor**
A visit used to be one of **five fixed slots** two hours apart, capped at **five
a day for the whole business**, and the cap was checked against whoever happened
to be the primary contractor. That is three separate ways of losing work: a crew
member with a free afternoon could not be booked into it, a busy one could be
booked on top of, and a day looked full to a customer while a second contractor
sat idle.

A visit is now **an hourly slot on one named contractor's day**. They run back to
back with **one hour between them**, and the only limits are that person's own
working window and the hour of clearance either side.

- **Whose calendar** is decided by the same routing that assigns the lead
  (`staff.service_types` → the primary contractor as a fallback), so the day the
  customer is shown is the day of the person who will actually drive out. The
  public form now passes its service to `/api/availability` for exactly this.
- **The hour of clearance is a distance, not a slot width.** A contractor who
  books an odd time from their job page - a 9:30 visit - blocks both the 9:00
  and the 10:00 slot, which a list of fixed slots could not express.
- **A booked work day still takes the whole day.** A pour is a crew, a truck and
  a day, so nothing else goes on that contractor's calendar that day.
- **Installs are unchanged: one per calendar day for the whole business.** Only
  visits stack.
- **The crew are not held to their own window** when they book a visit from the
  job page. The window decides what a *customer* is offered; fitting a visit
  around a real day is the thing a fixed window can't do.

**Working hours (CRM → Settings)**
Every person sets when they take visits: the **first** and **last** slot of the
day (default 8:00 AM to 4:00 PM, which is nine slots) and **which days of the
week** they take them. The panel shows the resulting slot list as you change it,
because two hour pickers and seven checkboxes don't tell anybody how many
appointments a day that adds up to.

Days default to **all seven**, not Monday-Friday. Customers could already book a
Saturday visit, and a migration that quietly cancels weekend availability for
every contractor at once is a policy change nobody asked for - so the preference
starts as "no restriction" and only narrows when somebody sets it.

**Scheduling conflict protection**
Every path that commits a date runs the same check before it writes:

| Path | Checked |
| --- | --- |
| Public quote form (`/api/quote`) | working day, slot exists, one hour clear |
| `confirmVisit` (job page + CRM) | one hour clear |
| `rescheduleVisit` (job page, CRM, calendar drag) | one hour clear |
| `setJobDate` → `confirmSchedule` | one install that day, contractor free |
| Reassigning a **dated** job (owner) | the new assignee is free that day/slot |

Staff screens name the customer already in the slot, which is what makes a clash
resolvable. The public form deliberately does not: that endpoint answers to
anyone, and "already with Jane Smith at 10am" hands a stranger a customer's name
and schedule.

There is **no unique index** behind the one-hour gap. It is a distance between
start times rather than a repeated value, so it isn't expressible as uniqueness,
and a 9:30 visit has to block two slots - which an index on
`(assigned_to, visit_date, visit_time)` would let straight through. Two things
narrow the race instead: the public form now writes `assigned_to` **with** the
row rather than patching it in a moment later, and every check above runs
server-side against live data rather than the browser's copy of it.

**Three bugs found auditing the accept-to-booked path**
1. **A duplicate approval put the price back up by $150.** Nothing stopped
   `recordCustomerResponse` running twice - a double tap, a retried request, a
   link open in two tabs. The second pass recomputed `quote_amount` from the
   line items while the $150 save credit was correctly guarded against being
   applied twice, so the customer's total went *up*, and the office got a second
   "QUOTE APPROVED" text about a job it already knew about. The same answer is
   now reported as the success it is with nothing written; a *different* answer
   is refused rather than quietly applied, because flipping an accepted quote to
   declined from a stale tab would strand a booked day and a crew already told
   to turn up.
2. **A lost job held its calendar day forever.** `qr_one_job_per_day` and
   `countJobsOn` both matched on `customer_response = 'accepted'` without
   excluding lost jobs, so a customer who accepted, got a date and then pulled
   out kept that day locked if the lead was dragged to Lost rather than having
   its appointment cancelled - with nothing on any screen explaining why the day
   was full. Both now exclude lost.
3. **Reassigning a dated job skipped every conflict check.** Every other path
   picks a date for a known person; this one picks a person for a known date,
   and nothing looked at the new assignee's calendar. It now runs the same
   checks a booking does, for the work day and the quote visit both.

**"Confirmed" now means what it says**
An accepted quote whose day the crew has confirmed reads as **Installation
scheduled**, in green, on the contractor's job page. It used to read "Customer
hasn't confirmed yet" in red until they answered the reminder link that goes out
*two days before the pour* - so a job both sides had agreed spent a fortnight
looking like it was falling through.

`confirmed_at` is still recorded when the customer answers that reminder; it just
isn't a warning any more. The pipeline card's **Confirmed / Not confirmed** pill
pair is gone with it: the column heading already says Scheduled, and worse,
"Not confirmed" meant something completely different on the crew's own job page,
where it sat on a slot a customer had merely *offered*. That one now reads **Not
booked yet**.

**Pipeline card pills**
A card that wears five pills is read as decoration and skimmed past. Three rules
keep the count down:
1. The date pill already says which kind of appointment it is (`Job Sep 12` /
   `Visit Sep 12`), so the **type** pill is dropped whenever a date is showing
   and the type is the in-person default. Online and From-plans stay - those
   change what you'd do next.
2. **Confirmed / Not confirmed** is gone (above).
3. **Viewed** and the **assignee** stay: nothing else on screen carries them.

A null `quote_type` is also labelled "In-person quote" rather than a vague
"Lead". Everything else in the system - `visitDateOf`, the calendar, the crew
reminders - reads null as in-person, because that is what every row predating the
column actually was. The card was the only place that disagreed, and it made a
row occupying a visit slot look like it wasn't one.

**Routing leads to contractors**
Each contractor has the job types they take (CRM → Crew → Edit details), keyed to the services in `quoteServiceOptions`. A new lead goes to the first active contractor who takes that service, falling back to the primary contractor in Settings when nothing claims it. Nothing ticked means no restriction, so routing is inert until an owner sets a rule.

**Job photos**
Customer uploads stay in `file_urls`. Staff photos are separate: `internal_urls` (site notes), `before_urls` and `after_urls`. A job cannot be marked complete without at least one before and one after photo - enforced in the `completeJob` server action, so it holds for the owner's CRM button as well as the crew's job page.

Run `supabase/quote-detail.sql` for all of the above (quote sections, `quote_expires_at`, the three photo columns, and `staff.service_types`).

**Google Calendar invites (optional)**
When a job is booked (customer accepts) or you assign a contractor to a dated job/visit, the app
creates an event on your Google Calendar and **invites the assigned contractor** (using the email
they were created with) and the customer (if we have their email). Re-running keeps the same event,
so assigning a contractor later still sends them the invite.

Setup (one-time):
1. Re-run `supabase/crm.sql` - it adds `quote_requests.gcal_event_id` and an `app_integrations` table for the OAuth token.
2. In **Google Cloud Console** → create a project → **APIs & Services**:
   - Enable the **Google Calendar API**.
   - **OAuth consent screen**: External, add yourself as a test user (or publish).
   - **Credentials → Create OAuth client ID → Web application**. Add an **Authorized redirect URI** that matches `GOOGLE_REDIRECT_URI` below exactly.
3. Add these Vercel env vars:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - from the OAuth client.
   - `GOOGLE_REDIRECT_URI` - e.g. `https://crm.raleighconcrete.net/api/google/callback` (must be registered in step 2, exactly).
   - `GOOGLE_CALENDAR_TZ` *(optional)* - IANA zone for timed visit events (default `America/New_York`).
4. Redeploy, then go to **CRM → Calendar** and click **Connect Google Calendar** (owner only). The contractor's login email is the address that receives invites.

## Getting paid (Stripe Connect + cash)

Run `supabase/payments.sql` once. It adds the Stripe columns on `staff`, the fee
columns on `quote_requests`, the `quote_payments` ledger and `fee_settlements`.

**The one rule everything else follows:** money moves in one direction. The
customer pays the **contractor**, and the contractor pays the office its
percentage out of that. The office never holds a customer's money and never owes
a contractor anything, so every balance in the system is something owed *to* the
office and never the other way round.

**Direct charges.** Every card payment is created on the contractor's own
connected account (`Stripe-Account: acct_…`), so they are the merchant of record:
their balance, their card fees, their 1099-K. Only the office's cut moves, as a
Stripe `application_fee_amount`. Leave that header off and the money lands in the
platform account instead, which is the exact thing this design exists to avoid.

**The fee.** 15% of the job total for a contractor's first three *paid* jobs,
10% after. The rate is frozen onto the job the first time money actually moves
(`ensureFeeOnJob`) and never recalculated, so crossing the threshold mid-job
can't reprice work that was already agreed. The **total** is re-derived against
the job's current price, so a job that grows tops the office up.

Card payments carry as much of the fee as they can (`applicationFeeFor`), capped
one cent below the charge because Stripe rejects a fee equal to the payment. On a
normal job the whole fee comes out of the deposit and the final payment is
entirely the contractor's. Cash collects nothing, so the fee stays owed and shows
up on the cash board until they Zelle or Venmo it over.

What a contractor owes *today* is bounded by what the customer has actually
handed them (`feeDueNowCents`): a $500 cash deposit on a $10,000 job makes $500
due, not $1,500. The rest becomes due as the balance comes in.

**Where each person meets it**

| Who | Where | What they can do |
| --- | --- | --- |
| Customer | `/q/<token>` at the moment they approve | Pay the 50% deposit by card, or approve and pay the crew directly |
| Customer | `/pay/<token>` | Deposit, balance, or part of it. Same link for the life of the job |
| Crew | `/job/<token>` → Money on this job | Text a card link, or record cash / check / Zelle / Venmo |
| Office | `/crm/quotes/<id>` → Money on this job | Same two, plus refunds |
| Owner | `/crm/money` | Everything collected, what each contractor owes, who still owes you |

The card-or-cash choice is put to the customer at the point of highest intent -
the approval itself - and never as a separate step later. Both answers approve
the quote; only the route afterwards differs.

**Cash counts immediately.** No approval queue: the crew records what they were
handed and you get a text within seconds saying how much, from whom, what is left
to collect and what they now owe you. A queue would only mean the balance on
screen is wrong for a day.

**Setup**

1. Vercel env: `STRIPE_PRIV_KEY` (secret key), `STRIPE_WEBHOOK_SEC` (signing
   secret). `STRIPE_PUB_KEY` is not used - checkout is a server-side redirect to
   Stripe's hosted page, so no publishable key ever reaches the browser.
2. Stripe → **Developers → Event destinations** → endpoint
   `https://www.raleighconcrete.net/api/stripe/webhook`, with **Events from:
   Connected accounts**. This is not optional: direct charges belong to the
   connected account, so with the default "Your account" scope you receive
   **zero** `checkout.session.completed` events and every payment silently stays
   unpaid. Subscribe to `checkout.session.completed`, `charge.refunded` and
   `account.updated`.
3. Per contractor: create an **Express** account in the Stripe Dashboard, send
   them the onboarding link, then paste the `acct_…` into CRM → Crew → Gets paid.
   Account settings: country **United States**, Stripe fees paid by **the
   connected account**, negative balance liability **your platform**,
   capabilities **card_payments** + **transfers**, MCC **1771 (Concrete Work
   Services)**, payouts **daily automatic**.

The endpoint lives at `/api/stripe/webhook`, not under `/crm`, because the CRM
middleware redirects any cookie-less request to the login page - Stripe sends no
cookies, so an endpoint under `/crm` would answer every delivery with a 307.

**Belt and braces.** The webhook is the primary path, but the customer lands back
on `/pay/<token>?done=cs_…` within a second of paying and the two race, so that
page asks Stripe directly (`reconcileCheckout`) and settles up if the webhook
hasn't yet. Both paths use the same conditional update, so whichever arrives
second finds nothing to do. It also means a misconfigured endpoint degrades to
"a beat slower" rather than "nothing is ever marked paid".

**Affirm** is not hard-coded anywhere: `payment_method_types` is deliberately
left off the Checkout Session, so each contractor's checkout offers whatever
their own account has enabled. Apply for it on one account and it appears with no
deploy. Worth knowing first - Affirm's prohibited list names "home improvement
services, including contractors and special trade contractors", MCC 1771 is
*Restricted*, it costs 6% + 30¢ (which the contractor bears under direct
charges), and platforms don't qualify for the 0% APR plans.

**Refunds** always pass `refund_application_fee`. Without it Stripe returns the
customer's money out of the contractor's balance while the platform keeps its
cut, so a refunded job would cost the crew the full amount *plus* the fee.

**The ledger is append-only.** `supabase/payments.sql` grants no `delete` on
`quote_payments`. A payment that turns out to be wrong is refunded or corrected,
never erased - it is the record the office and the contractor settle up from.

## Deploy to Vercel
This is a standard Next.js app - Vercel builds it in the cloud (no local build needed).

**Option A - GitHub → Vercel (no npm on your machine):**
1. Push this folder to a GitHub repo.
2. Vercel → Add New → Project → import the repo → Root Directory: `website` → deploy.

**Option B - Vercel CLI:**
```bash
npx vercel        # first run: log in, link project
npx vercel --prod # production deploy
```

## Run locally (optional, requires install)
```bash
npm install
npm run dev   # http://localhost:3000
```
