import type { NextConfig } from "next";

import { coreServices, isCityServicePair, locationKeys } from "./src/lib/site-data";

const NOINDEX = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" };

// Baseline hardening applied to every response.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// Customer/contractor capability tokens live in the URL of these pages; never
// leak them to third parties via the Referer header.
const NO_REFERRER = { key: "Referrer-Policy", value: "no-referrer" };

// ── Retired city+service URLs ────────────────────────────────────────────────
// Every city+service pair with no hand-written copy in
// src/lib/site-data.ts's `cityServiceLocalContent` gets a permanent (301)
// redirect to its service page, so Google transfers the signal instead of
// just losing the URL. These pairs used to be generated from a sentence
// template with the city name swapped in, which is why Search Console
// reported "Duplicate, Google chose different canonical" on
// /chapel-hill/stamped-decorative-concrete and left most of the sitemap at
// "Discovered - currently not indexed": there wasn't enough unique content
// per page to justify the crawl.
//
// Raleigh's four bespoke pages (/raleigh/concrete-driveways, etc.) are NOT
// redirected - they're real pages Search Console already prefers and
// docs/seo.md targets directly.
//
// Derived from site-data so a pair can never be un-published without also
// gaining a redirect, and never gain a redirect while it still has a page.
const RETIRED_LOCATION_REDIRECTS = locationKeys.flatMap((location) =>
  coreServices
    .filter((s) => !isCityServicePair(location, s.slug))
    .map((s) => ({
      source: `/${location}/${s.slug}`,
      destination: `/services/${s.slug}`,
      permanent: true,
    })),
);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return RETIRED_LOCATION_REDIRECTS;
  },
  images: {
    // Serve modern formats (AVIF first, WebP fallback). Originals stay lossless
    // PNGs; Vercel re-encodes on the fly, so visitors download much smaller
    // files with no perceptible quality loss. AVIF at q90 is visually
    // indistinguishable from the source while being a fraction of the size.
    formats: ["image/avif", "image/webp"],
    qualities: [75, 90],
    minimumCacheTTL: 31536000,
  },
  async headers() {
    // Security headers everywhere; private surfaces also get noindex. The public
    // marketing pages (home, services, locations, gallery, estimate, privacy
    // policy) stay indexable so Google can rank them.
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Photos in public/images are content, not code: a given filename always
      // holds the same picture, and a changed picture arrives under a new name.
      // Without this they're served must-revalidate, so every repeat visit
      // spends a round-trip re-confirming a file that cannot have changed.
      // Optimized variants (/_next/image) already have minimumCacheTTL above;
      // this covers the originals and anything linked directly.
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // The CRM must never be framed (clickjacking) — belt-and-suspenders with
      // X-Frame-Options via the modern frame-ancestors directive.
      {
        source: "/crm/:path*",
        headers: [NOINDEX, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
      { source: "/api/:path*", headers: [NOINDEX] },
      { source: "/q/:path*", headers: [NOINDEX, NO_REFERRER] },
      { source: "/job/:path*", headers: [NOINDEX, NO_REFERRER] },
      { source: "/confirm/:path*", headers: [NOINDEX, NO_REFERRER] },
    ];
  },
};

export default nextConfig;
