import type { NextConfig } from "next";

const NOINDEX = [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
