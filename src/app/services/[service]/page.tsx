import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServicePage } from "@/components/service-page";
import { getService, isCityServicePair, serviceSlugs } from "@/lib/site-data";

type PageProps = {
  params: Promise<{ service: string }>;
};

export function generateStaticParams() {
  return serviceSlugs.map((service) => ({ service }));
}

export const dynamicParams = false;

// Slugs that also have a bespoke /raleigh/<slug> page (docs/seo.md's P1
// driveway and stamped-concrete clusters, targeted at those URLs
// specifically). This page must NOT title itself "<Service> Raleigh NC" for
// those - it would put two of our own pages up against each other for the
// identical phrase, the same pattern Search Console already flagged
// elsewhere on the site ("Duplicate, Google chose different canonical").
// Every other service has no city-specific competitor, so it keeps the
// Raleigh-branded title to carry that local intent itself.
const SLUGS_WITH_OWN_RALEIGH_PAGE = new Set(
  serviceSlugs.filter((slug) => isCityServicePair("raleigh", slug)),
);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { service } = await params;
  const content = getService(service);

  if (!content) {
    return { title: "Service Not Found" };
  }

  const hasOwnRaleighPage = SLUGS_WITH_OWN_RALEIGH_PAGE.has(content.slug);
  const title = hasOwnRaleighPage ? `${content.name} | Raleigh Concrete Group` : `${content.name} Raleigh NC`;
  const ogTitle = hasOwnRaleighPage
    ? `${content.name} | Raleigh Concrete Group`
    : `${content.name} in Raleigh, NC | Raleigh Concrete Group`;

  return {
    title,
    description: content.blurb,
    alternates: { canonical: `/services/${content.slug}` },
    openGraph: {
      title: ogTitle,
      description: content.blurb,
      images: [content.image],
      type: "website",
    },
  };
}

export default async function ServiceRoutePage({ params }: PageProps) {
  const { service } = await params;
  const content = getService(service);

  if (!content) {
    notFound();
  }

  return <ServicePage service={content} />;
}
