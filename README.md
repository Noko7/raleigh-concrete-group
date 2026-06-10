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
    quote-form.tsx         # quote form (replaces mammoth's Calendly)
  lib/
    site-data.ts        # ALL content: services, locations, gallery, reviews
public/images/          # photos (placeholders — replace with real project shots)
```

## Edit content
Everything lives in `src/lib/site-data.ts`:
- **`businessName`, `phoneDisplay`, `phoneHref`, `textHref`** — your NAP.
- **`services`** — name + description + tier (`primary` cards are highlighted).
- **`locations`** — add/remove a city and it auto-creates a page, nav pill, and sitemap entry.
- **`galleryImages`**, **`sharedBeforeAfter`**, **`testimonials`**.

## Before launch — replace placeholders
1. **Phone** — `(919) 555-0199` / `+19195550199` in `site-data.ts`.
2. **Photos** — the images in `public/images/` are **placeholders** (epoxy stock from the template
   repo). Drop in your real concrete/hardscape project photos using the same filenames, or update
   the paths in `site-data.ts`. Before/after pairs: `before-after-1-*.jpg`, `before-after-2-*.jpg`.
3. **Domain** — `https://www.raleighconcrete.net` in `src/app/layout.tsx` (`metadataBase`).
4. **Reviews** — swap the testimonials for real Google reviews (never fabricate).

## Quote form
Runs in **demo mode** (shows success, sends nothing) until you set an endpoint:
- Create a form at [formspree.io](https://formspree.io), then in Vercel set an env var
  `NEXT_PUBLIC_FORM_ENDPOINT` = your Formspree URL. `quote-form.tsx` auto-detects it.

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
