import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LocationPage } from "@/components/location-page";
import { locationKeys, locations, type LocationKey } from "@/lib/site-data";

type PageProps = {
  params: Promise<{ location: string }>;
};

export function generateStaticParams() {
  return locationKeys.map((location) => ({ location }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { location } = await params;

  if (!locationKeys.includes(location as LocationKey)) {
    return { title: "Location Not Found" };
  }

  const content = locations[location as LocationKey];

  return {
    title: content.seoTitle,
    description: content.description,
    alternates: { canonical: `/${content.key}` },
    openGraph: {
      title: content.seoTitle,
      description: content.description,
      images: [content.heroImage],
      type: "website",
    },
  };
}

export default async function LocationRoutePage({ params }: PageProps) {
  const { location } = await params;

  if (!locationKeys.includes(location as LocationKey)) {
    notFound();
  }

  return <LocationPage locationKey={location as LocationKey} />;
}
