import type { MetadataRoute } from "next";

const BASE_URL = "https://www.raleighconcrete.net";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep the CRM, API endpoints and private customer/token pages out of search.
      disallow: ["/crm", "/api/", "/q/", "/job/", "/confirm"],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
