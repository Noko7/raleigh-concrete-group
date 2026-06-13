import type { NextConfig } from "next";

const NOINDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];

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
    // Only keep private surfaces out of search. The public marketing pages
    // (home, services, locations, gallery, estimate, privacy policy) are
    // intentionally left indexable so Google can rank them.
    return [
      { source: "/crm/:path*", headers: NOINDEX },
      { source: "/api/:path*", headers: NOINDEX },
      { source: "/q/:path*", headers: NOINDEX },
      { source: "/job/:path*", headers: NOINDEX },
      { source: "/confirm/:path*", headers: NOINDEX },
    ];
  },
};

export default nextConfig;
