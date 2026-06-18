import { businessName, phoneDisplay, services } from "@/lib/site-data";

export const SITE_URL = "https://www.raleighconcrete.net";
export const BUSINESS_ID = `${SITE_URL}/#business`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

// Service-area business: we serve the Triangle from Raleigh. We assert the
// locality/region (no fabricated street address) plus an explicit areaServed.
export const SERVICE_AREAS = [
  "Raleigh",
  "Cary",
  "Apex",
  "Wake Forest",
  "Durham",
  "Chapel Hill",
  "Morrisville",
  "Garner",
  "Holly Springs",
  "Knightdale",
];

const PHONE_E164 = "+19198977695";

export function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "HomeAndConstructionBusiness",
    "@id": BUSINESS_ID,
    name: businessName,
    url: SITE_URL,
    telephone: PHONE_E164,
    image: `${SITE_URL}/images/logo_horizontal_light.png`,
    logo: `${SITE_URL}/images/logo_horizontal_light.png`,
    description:
      "Concrete and hardscaping contractor in Raleigh, NC. Driveways, patios, walkways, retaining walls, stamped concrete and pavers for residential and commercial clients across the Triangle.",
    foundingDate: "2020",
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Raleigh",
      addressRegion: "NC",
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 35.7796,
      longitude: -78.6382,
    },
    areaServed: SERVICE_AREAS.map((city) => ({ "@type": "City", name: `${city}, NC` })),
    knowsAbout: services.map((s) => s.name),
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "07:00",
        closes: "19:00",
      },
    ],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE_URL,
    name: businessName,
    publisher: { "@id": BUSINESS_ID },
  };
}

export function serviceSchema(opts: {
  name: string;
  serviceType?: string;
  description: string;
  slug: string;
  image?: string;
  url?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    serviceType: opts.serviceType ?? opts.name,
    url: opts.url ? `${SITE_URL}${opts.url}` : `${SITE_URL}/services/${opts.slug}`,
    ...(opts.image ? { image: `${SITE_URL}${opts.image}` } : {}),
    description: opts.description,
    provider: { "@id": BUSINESS_ID },
    areaServed: SERVICE_AREAS.map((city) => ({ "@type": "City", name: `${city}, NC` })),
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export { phoneDisplay };
