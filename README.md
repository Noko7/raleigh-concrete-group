# Raleigh Concrete Group — Website

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
- **`businessName`, `phoneDisplay`, `phoneHref`, `textHref`** — your NAP.
- **`services`** — the service catalog. Each entry has a `slug`, `name`, `navLabel`,
  `group` (`core` shows in the nav + homepage; `concrete`/`hardscaping` show in the full menu),
  `blurb`, `intro`, `bullets`, `image`, and optional `beforeAfter`. Adding one auto-creates a
  page at `/services/<slug>`.
- **`locations`** — city pages live at `/<city>` (linked from the footer, not the main nav).
- **`galleryImages`**, **`sharedBeforeAfter`**, **`testimonials`**.

## Before launch — final touches
1. **Phone** — set to `(919) 873-3919` in `site-data.ts`. ✅
2. **Photos** — real project photos + logos are in `public/images/`. ✅ (They're large PNGs;
   Vercel's image optimization handles resizing automatically, but you can compress them for
   faster builds.)
3. **Domain** — `https://www.raleighconcrete.net` in `src/app/layout.tsx` (`metadataBase`).
4. **Reviews** — swap the testimonials for real Google reviews (never fabricate).

## Quote funnel → Supabase
Clicking any **Get Free Quote** button opens a multi-step modal (`src/components/quote-modal.tsx`):

1. **Choose a path** — Online quote (fastest) or In-person visit.
2. **Address** — with free autocomplete (Photon/OpenStreetMap, no API key needed), biased to Raleigh.
3a. **Online:** upload photos/video (saved to Supabase Storage) so we can quote from satellite + pics.
3b. **In-person:** pick a scheduling window.
4. **Contact** — name, phone, email → saved as a lead.

Everything is captured early and the form is split into small steps, which converts far better than a
single long form. Submissions save to Supabase via its REST API (no SDK installed). Runs in
**demo mode** (shows success, saves nothing) until the keys below are set.

**One-time setup:**
1. In Supabase → **SQL Editor**, paste & run `supabase/schema.sql`. This creates the
   `quote_requests` table, the `quote-uploads` storage bucket, and policies that let the public site
   insert leads + upload files but not read them.
2. In Supabase → **Project Settings → API**, copy the **Project URL** and **anon public** key.
3. In Vercel → **Settings → Environment Variables**, make sure these two exist (the Supabase
   integration may have added them already — confirm the `NEXT_PUBLIC_` prefix, the browser needs it):
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
about actually changes. Nothing internal — assignments, price edits, notes,
status drags — ever texts the customer.

1. **New** — quote arrives, auto-assigned to your primary contractor. Owner + contractor get the full brief; the customer gets an acknowledgement (in-person includes their visit date/time).
2. You set a price + description and hit **Send Quote** → customer gets their quote link (**Quoted**).
3. Customer approves and picks **up to 3 days that suit them** → they're told we'll confirm shortly; owner + contractor are told it **needs a date** (**Needs scheduling**). Declining notifies owner + contractor (**Lost**).
4. The assigned contractor (or an owner) confirms one of those days on the job page → **this is what books it**: the customer is texted their date, the crew gets the brief, and it lands on Google Calendar (**Scheduled**).
5. Changing that date later texts the customer that it moved, re-notifies the crew, and updates the calendar. The 2-day reminder resets so they still get one.
6. Two days before, a daily cron texts the customer a confirm link. "Need to reschedule" pings owner + contractor.
7. **Mark completed** → customer gets a thank-you + Google review link. **Request payment** → payment instructions. **Mark paid** closes it out.

Why the split at step 3/4: letting the customer book a day outright committed
the crew to dates nobody had checked. They now propose, the crew disposes — so
scheduling is settled in one text each way instead of a phone-tag loop.

**Owner alerts** are limited to the moments worth interrupting you: new lead,
approved, declined, date confirmed or moved, can't-confirm, completed, and paid.
You're never texted about an action you performed yourself.

**One-time setup**
1. Run `supabase/schema.sql` first (if you haven't), then `supabase/crm.sql`, then `supabase/agreements.sql`, `supabase/scheduling.sql`, `supabase/scheduled-time.sql`, `supabase/crew-reminders.sql`, `supabase/invites.sql`, `supabase/invite-tracking.sql` and `supabase/locale.sql` in the SQL Editor.

   `supabase/crew-reminders.sql` also (re)adds `scheduled_time`, so running just
   that one file is enough to fix "Could not save that date" when confirming a
   work day. Every file is safe to re-run.
2. Confirm Vercel env vars exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the CRM needs the service-role key).
3. Create your owner login: Supabase → **Authentication → Users → Add user** (email + password), then run the promote snippet at the bottom of `supabase/crm.sql`.
4. **Subdomain:** in Vercel → Project → **Domains**, add `crm.raleighconcrete.net`; in your DNS registrar add the **CNAME** Vercel shows (typically `crm` → `cname.vercel-dns.com`). Routing to the CRM is already wired in `src/middleware.ts`. (Until DNS is live you can also reach it at `raleighconcrete.net/crm`.)

**Hook your text automation up to the links**
Your Supabase automation already fires on new `quote_requests` rows. Each row now also has
`public_token` and `job_token` columns — build the URLs in your message template:
- Contractor text (with photos): `https://raleighconcrete.net/job/{{ job_token }}`
- Customer text (their quote): `https://raleighconcrete.net/q/{{ public_token }}`

**English / Spanish**
Every CRM screen a contractor can reach renders in **English or Spanish**, per person. They choose
on the onboarding form before their account exists, and can change it any time under **Settings →
Language**. The choice lives on their staff row, so it follows them to any device.
- The **login screen** has English/Español links, since there's no account to read a preference from
  yet (`/crm/login?lang=es`).
- Translations live in `src/lib/crm/i18n.ts`. There's no i18n package — the Spanish dictionary is
  typed as `typeof en`, so **a missing translation fails the build** rather than silently showing
  English to a Spanish speaker.
- Owner-only admin screens (Contractors, Security, Archived) are English only — no contractor sees
  them. Customer-facing pages are unchanged.

**Adding a contractor**
Preferred way: **CRM → Contractors → Invite a contractor**. Enter their phone number and they get a
one-time link to `/join/<token>` where they fill in their own name and email and choose their own
password. Nothing is created until they finish, so a mistyped number just expires.
- The link is **single-use**, expires in **7 days**, and can be cancelled from the Signups list.
- The **Signups** table tracks how far each invite got: *Sent, not opened* → *Opened, not finished* →
  *Account created*. "Opened, not finished" is the one worth chasing — they tapped the link and got
  stuck. Repeat opens are counted, so `·3×` means they've tried three times.
- Their alert number comes from the invite you sent, not the form, so it can't be pointed elsewhere.
- The invite is valid even if the text fails — the link is always shown in the CRM so you can pass it
  on another way.
- Manual creation (you set a temp password) is still there under "Or add a contractor manually".

**Contractors sign in with their own email** — gmail, icloud, whatever they already use. No
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
send it, and DocuSeal emails the signer and hosts the signing page. The CRM is the *record* of it —
**CRM → Agreements** (`/crm/agreements`) tracks status, and stores the signed file.
- **Contractor agreements** — one onboarding doc per crew member, added from **CRM → Contractors**.
- **Customer agreements** — one per job, added from that job's page.
- Statuses: Not sent → Awaiting signature → Signed (or Declined / Void). You set these yourself,
  since DocuSeal isn't wired into the app.
- Files live in a **private** `agreements` storage bucket and are only ever served through
  `/crm/api/agreement`, which scopes access with RLS: an owner sees everything, a contractor sees
  only their own agreement and jobs assigned to them.
- Requires `supabase/agreements.sql` (step 1 above). No new env vars, no npm packages.
- Note: a customer with no email on file can't be emailed by DocuSeal — the quote form makes email
  optional, so check the job page before sending.

**Built-in SMS alerts (owner + contractor)**
The app texts you and your crew automatically: a **new lead** texts the owner; **assigning** a job
texts that contractor their job link; and when a contractor advances a job the owner gets a heads-up.
Add these Vercel env vars (no SQL needed):
- `OWNER_PHONE` — your number for owner alerts (e.g. `+19198733919`).
- **Quo (OpenPhone)** — the default when `QUO_API_KEY` is set:
  - `QUO_API_KEY` — from Quo → Settings → API (used as the `Authorization` header).
  - `QUO_FROM` — your Quo number in E.164 (e.g. `+19198733919`).
  - `QUO_USER_ID` *(optional)* — send as a specific workspace member.
  - Note: Quo requires completed **US carrier (A2P) registration** to text US numbers.
- `SMS_PROVIDER` *(optional override)* — `quo`, `twilio`, or `custom`.
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
- Custom provider: `SMS_API_URL`, `SMS_API_KEY`, `SMS_FROM` (POSTs `{ to, from, message }` with a `Bearer` key).

Each person sets their own alert number under **CRM → Settings** (`/crm/settings`). Owner alerts go to every active owner's number **plus** `OWNER_PHONE`; contractor alerts use that contractor's saved number. The person who performs an action isn't texted about their own click. SMS is best-effort — a texting outage never blocks a quote from saving.

**Testing texts (owner only)**
**CRM → Settings** has a **Text notifications** panel that shows the active provider, the sending
number, any missing env vars, and exactly which numbers an owner alert would reach. The **Send test
text** button sends one real message and prints the provider's raw response, which is how you tell
these apart:
- `401` — bad or missing `QUO_API_KEY`.
- `400` with *A2P Registration Not Approved* — the key is fine, but the carrier hasn't approved the
  brand/campaign yet. Nothing in the app can work around this.
- `403` *Not Phone Number User* — `QUO_FROM` isn't a number your `QUO_USER_ID` can send from. Clear
  `QUO_USER_ID` to default to the number's owner.
- **Accepted** but no text arrives — the provider took it; the hold-up is carrier delivery.

`QUO_FROM` must be E.164 (`+19198733919`) or a Quo phone ID (`PN…`). Leave the number blank in the
test panel to text every owner number at once.

Customer-facing text settings:
- `OWNER_NAME` *(optional)* — first name used to introduce the business in the **first** text a customer gets (default `Noah`), e.g. "this is Noah with Raleigh Concrete Group". Every later message speaks as the business, so a name here doesn't tie the whole thread to one person.
- `GOOGLE_REVIEW_URL` *(optional)* — your Google review link; included in the post-job thank-you text. If unset, the thank-you still sends without a link.

**Daily reminders (Vercel Cron)**
Two daily crons, both declared in `vercel.json` and both free on the Hobby plan (it allows up to two cron jobs, each once a day). Both share the same `CRON_SECRET` env var in Vercel — sent as a Bearer token, and the endpoints reject anything else.

- `/api/cron/reminders` (14:00 UTC, ~10am ET) — flushes anything quiet hours held overnight, then four jobs: the 2-day customer confirmation text for a booked job; the crew countdown (3 days out, day before, morning of); a nudge to the assigned contractor (+ owner) about a lead nobody has quoted 12+ hours after it came in; and a follow-up text to a customer who hasn't accepted or declined a sent quote within 48 hours. Confirming a job flips it to **Confirmed**; "need to reschedule" texts the owner + contractor.
- `/api/cron/visit-reminders` (22:00 UTC, ~6pm ET) — kept separate because it needs an evening run time; also flushes the held queue on its way past: texts both the customer and the assigned contractor (with the address) about tomorrow's in-person quote visit.

Since both crons only run once a day, a 12h or 48h threshold can be noticed up to ~24h late — an acceptable tradeoff for staying on the free plan.

The two nudges only chase work from the last **14 days** (`REMINDER_MAX_AGE_DAYS` in `src/lib/crm/queries.ts`). That keeps them off stale pipeline nobody intends to work, and — because every existing row counts as un-reminded the first time this runs — stops the first cron after deploy texting every historical lead and old unanswered quote at once.

Run `supabase/hourly-reminders.sql` before deploying this — it adds the tracking columns (`stale_lead_reminded_at`, `visit_reminder_sent_at`, `visit_crew_reminded_at`, `quote_followup_sent_at`) each new job uses to avoid sending the same reminder twice. Moving or cancelling a visit clears its two markers, so the new day gets its own reminders.

**Quiet hours: nothing goes out 7pm-8am**
Every text this app sends is gated on the Raleigh clock. A message raised between 7pm and 8am Eastern is not sent and not dropped — it is written to the message log with a `send_after` on it and delivered the next morning, so an 11pm booking still texts the customer, at 8am. Run `supabase/quiet-hours.sql` to add the two columns this needs (`send_after`, `sent_at`).

The queue drains from three places, because a serverless app has nothing sitting around to wake up at 8am: both daily crons flush it first thing, and so does any text sent during business hours. In practice a held message goes out on the first activity after 8am, and the 10am cron is the floor if the morning is quiet. If you want it delivered at 8:00 exactly, that is a third cron (`/api/cron/reminders` at `0 12 * * *`) — Vercel's Hobby plan allows two, so it needs a plan that allows three.

One text ignores quiet hours: the Settings → Text notifications test message. You asked for it, you are holding the phone, and a test that arrives twelve hours later answers nothing.

A held message shows in the job's **Texts sent** log as "Waiting for 8:00 AM" rather than as a failure, and the CRM says so where it reports a send — the quote banner, the contractor invite and password notes.

**Time is Eastern, everywhere**
`src/lib/crm/clock.ts` owns every reading of the clock: `now()`, today's date, day arithmetic, quiet hours. Vercel runs in UTC and phones are set to whatever their owners set them to, so anything asking "what day is it" or printing a timestamp goes through there and comes back in `America/New_York` — Eastern, which is EST in winter and EDT in summer, not a pinned -05:00 that would be an hour out all summer.

Time itself is the host clock, not an NTP query: serverless functions get outbound TCP only (NTP is UDP/123), and Vercel's AWS instances are already disciplined by Amazon's own time service, which is steadier than a public pool server reached over the internet. Settings → **Time & quiet hours** shows the current Raleigh time, whether texts are sending right now, and a drift check against a public HTTPS host's `Date` header as a second opinion.

> If you also send texts from a Make.com scenario, disable that scenario (or the SMS step) to avoid sending duplicate messages, since the app now texts directly through Quo.

**What a customer text never contains**
The price. A figure in a text has no scope beside it, gets forwarded and shopped around on its own, and the customer already has a quote page built to explain it — so every customer-facing message carries the link instead. `usd()` in `src/lib/crm/notify.ts` is for `role: "owner"` and `role: "crew"` messages only; check the role on the send before using it. Em dashes are stripped from every outbound text by `noEmDash()` (`src/lib/crm/constants.ts`), applied centrally in `sendSmsResult` so copy assembled from owner-typed content is covered too.

**Quotes: five sections, seven days**
Every quote answers Scope, Permits, Demolition and prep, Pour and finish, and Clean up. All five must say something before it can be sent, but "Not applicable" is a valid answer and each field has a one-tap button for it. Quotes written before this change fall back to their old free-text summary.

A sent quote link is good for `QUOTE_TTL_DAYS` (7) days from the last send. Re-sending re-stamps the clock, which is how an expired quote is revived. Expiry only applies while the customer still has a decision to make — once they've accepted, the page is their record of the job and the payment text links back to it.

**Routing leads to contractors**
Each contractor has the job types they take (CRM → Crew → Edit details), keyed to the services in `quoteServiceOptions`. A new lead goes to the first active contractor who takes that service, falling back to the primary contractor in Settings when nothing claims it. Nothing ticked means no restriction, so routing is inert until an owner sets a rule.

**Job photos**
Customer uploads stay in `file_urls`. Staff photos are separate: `internal_urls` (site notes), `before_urls` and `after_urls`. A job cannot be marked complete without at least one before and one after photo — enforced in the `completeJob` server action, so it holds for the owner's CRM button as well as the crew's job page.

Run `supabase/quote-detail.sql` for all of the above (quote sections, `quote_expires_at`, the three photo columns, and `staff.service_types`).

**Google Calendar invites (optional)**
When a job is booked (customer accepts) or you assign a contractor to a dated job/visit, the app
creates an event on your Google Calendar and **invites the assigned contractor** (using the email
they were created with) and the customer (if we have their email). Re-running keeps the same event,
so assigning a contractor later still sends them the invite.

Setup (one-time):
1. Re-run `supabase/crm.sql` — it adds `quote_requests.gcal_event_id` and an `app_integrations` table for the OAuth token.
2. In **Google Cloud Console** → create a project → **APIs & Services**:
   - Enable the **Google Calendar API**.
   - **OAuth consent screen**: External, add yourself as a test user (or publish).
   - **Credentials → Create OAuth client ID → Web application**. Add an **Authorized redirect URI** that matches `GOOGLE_REDIRECT_URI` below exactly.
3. Add these Vercel env vars:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from the OAuth client.
   - `GOOGLE_REDIRECT_URI` — e.g. `https://crm.raleighconcrete.net/api/google/callback` (must be registered in step 2, exactly).
   - `GOOGLE_CALENDAR_TZ` *(optional)* — IANA zone for timed visit events (default `America/New_York`).
4. Redeploy, then go to **CRM → Calendar** and click **Connect Google Calendar** (owner only). The contractor's login email is the address that receives invites.

## Deploy to Vercel
This is a standard Next.js app — Vercel builds it in the cloud (no local build needed).

**Option A — GitHub → Vercel (no npm on your machine):**
1. Push this folder to a GitHub repo.
2. Vercel → Add New → Project → import the repo → Root Directory: `website` → deploy.

**Option B — Vercel CLI:**
```bash
npx vercel        # first run: log in, link project
npx vercel --prod # production deploy
```

## Run locally (optional, requires install)
```bash
npm install
npm run dev   # http://localhost:3000
```
