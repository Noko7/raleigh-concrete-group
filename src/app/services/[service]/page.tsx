import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServicePage } from "@/components/service-page";
import { getService, serviceSlugs } from "@/lib/site-data";

type PageProps = {
  params: Promise<{ service: string }>;
};

export function generateStaticParams() {
  return serviceSlugs.map((service) => ({ service }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { service } = await params;
  const content = getService(service);

  if (!content) {
    return { title: "Service Not Found" };
  }

  return {
    title: `${content.name} Raleigh NC`,
    description: content.blurb,
    alternates: { canonical: `/services/${content.slug}` },
    openGraph: {
      title: `${content.name} in Raleigh, NC | Raleigh Concrete Group`,
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
