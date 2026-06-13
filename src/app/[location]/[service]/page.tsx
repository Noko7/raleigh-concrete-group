import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CityServicePage } from "@/components/city-service-page";
import {
  cityServicePairs,
  getCityServiceContent,
  isCityServicePair,
  type LocationKey,
} from "@/lib/site-data";

type PageProps = {
  params: Promise<{ location: string; service: string }>;
};

export function generateStaticParams() {
  return cityServicePairs.map(({ location, service }) => ({ location, service }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { location, service } = await params;
  if (!isCityServicePair(location, service)) {
    return { title: "Page Not Found" };
  }
  const content = getCityServiceContent(location as LocationKey, service);
  if (!content) return { title: "Page Not Found" };

  return {
    title: content.metaTitle,
    description: content.metaDescription,
    alternates: { canonical: `/${location}/${service}` },
    openGraph: {
      title: content.metaTitle,
      description: content.metaDescription,
      images: [content.service.image],
      type: "website",
    },
  };
}

export default async function CityServiceRoutePage({ params }: PageProps) {
  const { location, service } = await params;
  if (!isCityServicePair(location, service)) {
    notFound();
  }
  return <CityServicePage locationKey={location as LocationKey} slug={service} />;
}
