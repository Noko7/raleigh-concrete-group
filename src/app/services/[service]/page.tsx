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

// Slugs with a bespoke /raleigh/<slug> page (the P1 targets in docs/seo.md). This page must NOT title
// itself "<Service> Raleigh NC" for those, or two of our pages compete for the same phrase. Other services
// keep the Raleigh-branded title.
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
