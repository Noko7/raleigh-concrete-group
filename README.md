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
1. **Phone** — set to `(919) 420-3146` in `site-data.ts`. ✅
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
