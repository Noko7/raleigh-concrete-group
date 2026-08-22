import type { MetadataRoute } from "next";

import { cityServicePairs, locationKeys, services } from "@/lib/site-data";

const BASE_URL = "https://www.raleighconcrete.net";

// Only URLs with real content belong here. `cityServicePairs` used to be the
// full 10-city x 6-service cross product; most of it was a sentence template
// with the city name swapped in, and Google left ~79 of ~99 sitemap URLs at
// "Discovered - currently not indexed" because there wasn't enough unique
// content per page to justify the crawl. It's now derived from the
// hand-written copy in site-data.ts's `cityServiceLocalContent`, so this
// sitemap only ever lists pages that exist and are worth indexing.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPaths = ["", "/about", "/estimate", "/gallery", "/privacy-policy", "/terms"];
  const servicePaths = services.map((s) => `/services/${s.slug}`);
  const locationPaths = locationKeys.map((k) => `/${k}`);
  const cityServicePaths = cityServicePairs.map(
    ({ location, service }) => `/${location}/${service}`,
  );

  return [...staticPaths, ...servicePaths, ...locationPaths, ...cityServicePaths].map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));
}
