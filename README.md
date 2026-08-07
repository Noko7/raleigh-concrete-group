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
- **Contractors** (`/crm/contractors`, owner only): create a crew login (returns a one-time temp password), deactivate/reactivate.
- **Settings** (`/crm/settings`): your name + alert number; owners also pick the **primary contractor** that new quotes auto-assign to.
- **Customers** (`/crm/customers`): quotes auto-grouped by phone/email with won-value totals.
- **Calendar** (`/crm/calendar`): a month view of booked jobs (`scheduled_date`) and in-person quote visits (`visit_date`). Click any item to open the deal. Owners can connect Google Calendar here.
- **Customer quote link** (`https://raleighconcrete.net/q/<public_token>`): branded, no-login page showing the price + summary; the customer accepts (and schedules) or declines right there.
- **Job confirmation link** (`https://raleighconcrete.net/confirm/<public_token>`): sent in the 2-day reminder so the customer can confirm or ask to reschedule.
- **Contractor job link** (`https://raleighconcrete.net/job/<job_token>`): no-login page with the photos, address (Maps link) and customer contact.

**Deal lifecycle + automatic texts** (kept short to save SMS credits)
1. **New** — quote arrives, auto-assigned to your primary contractor. Owner + contractor get a text; the customer gets an acknowledgement (in-person includes their visit date/time).
2. Contractor sets a price + description and hits **Send Quote** → customer gets their quote link (**Quoted**).
3. Customer accepts + picks a date → customer gets a "thanks for scheduling" text, owner + contractor get **JOB BOOKED** with details (**Booked**). Declining notifies owner + contractor (**Lost**).
4. Two days before the job, a daily cron texts the customer a confirm link. Confirming moves it to **Confirmed**; "need to reschedule" pings owner + contractor.
5. Contractor hits **Mark complete + paid** → customer gets a thank-you + Google review link (**Complete**).

**One-time setup**
1. Run `supabase/schema.sql` first (if you haven't), then `supabase/crm.sql` in the SQL Editor.
2. Confirm Vercel env vars exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the CRM needs the service-role key).
3. Create your owner login: Supabase → **Authentication → Users → Add user** (email + password), then run the promote snippet at the bottom of `supabase/crm.sql`.
4. **Subdomain:** in Vercel → Project → **Domains**, add `crm.raleighconcrete.net`; in your DNS registrar add the **CNAME** Vercel shows (typically `crm` → `cname.vercel-dns.com`). Routing to the CRM is already wired in `src/middleware.ts`. (Until DNS is live you can also reach it at `raleighconcrete.net/crm`.)

**Hook your text automation up to the links**
Your Supabase automation already fires on new `quote_requests` rows. Each row now also has
`public_token` and `job_token` columns — build the URLs in your message template:
- Contractor text (with photos): `https://raleighconcrete.net/job/{{ job_token }}`
- Customer text (their quote): `https://raleighconcrete.net/q/{{ public_token }}`

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

Customer-facing text settings:
- `OWNER_NAME` *(optional)* — first name used to sign customer texts (default `Noah`), e.g. "this is Noah with Raleigh Concrete Group".
- `GOOGLE_REVIEW_URL` *(optional)* — your Google review link; included in the post-job thank-you text. If unset, the thank-you still sends without a link.

**2-day confirmation reminder (Vercel Cron)**
A daily cron texts customers a confirm link about two days before their booked job. `vercel.json` already declares the schedule (`/api/cron/reminders`, 14:00 UTC). Add a `CRON_SECRET` env var in Vercel — Vercel sends it as a Bearer token and the endpoint rejects anything else. Confirming flips the job to **Confirmed**; "need to reschedule" texts the owner + contractor.

> If you also send texts from a Make.com scenario, disable that scenario (or the SMS step) to avoid sending duplicate messages, since the app now texts directly through Quo.

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
