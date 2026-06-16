import type { MetadataRoute } from "next";

import { cityServicePairs, locationKeys, services } from "@/lib/site-data";

const BASE_URL = "https://www.raleighconcrete.net";

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
