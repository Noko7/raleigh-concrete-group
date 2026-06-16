import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
