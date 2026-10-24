import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaqSection } from "@/components/faq-section";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { JsonLd } from "@/components/json-ld";
import { CtaButtons, MobileBar, QuoteCta, ServiceCard, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import { breadcrumbSchema, faqSchema, serviceSchema } from "@/lib/seo";
import {
  cityServicesFor,
  coreServices,
  galleryImages,
  getCityServiceContent,
  getService,
  type LocationKey,
  serviceSingular,
} from "@/lib/site-data";

export function CityServicePage({
  locationKey,
  slug,
}: {
  locationKey: LocationKey;
  slug: string;
}) {
  const content = getCityServiceContent(locationKey, slug);
  if (!content) return null;
  const { service, city, neighborhoods, paragraphs, projectExample, faqs } = content;

  // Only siblings with a hand-written page in THIS city; others 301, wasting internal link equity.
  const otherCoreInCity = cityServicesFor(locationKey)
    .filter((s) => s !== slug)
    .map((s) => getService(s))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const otherServicesElsewhere = coreServices.filter(
    (s) => s.slug !== slug && !otherCoreInCity.some((o) => o.slug === s.slug),
  );

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({
            name: `${service.name} in ${city}, NC`,
            serviceType: service.name,
            description: service.blurb,
            slug: service.slug,
            url: `/${locationKey}/${slug}`,
            image: service.image,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: city, path: `/${locationKey}` },
            { name: service.name, path: `/${locationKey}/${slug}` },
          ]),
          faqSchema(faqs),
        ]}
      />
      <SiteHeader activeService={slug} />

      <main>
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: city, path: `/${locationKey}` },
            { name: service.name, path: `/${locationKey}/${slug}` },
          ]}
        />

        <section className="relative overflow-hidden py-12 md:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="mb-5 font-headline text-4xl leading-[1] text-ivory md:text-6xl">
                {content.heading}
              </h1>
              {paragraphs.map((p) => (
                <p key={p.slice(0, 24)} className="mb-4 max-w-lg text-lg leading-relaxed text-slate-300">
                  {p}
                </p>
              ))}
              <div className="mt-2">
                <CtaButtons />
              </div>
            </div>
            <div>
              {service.beforeAfter ? (
                <BeforeAfterSlider
                  beforeSrc={service.beforeAfter.before}
                  afterSrc={service.beforeAfter.after}
                  beforeAlt={`${service.name} in ${city} before`}
                  afterAlt={`${service.name} in ${city} after`}
                  label={service.beforeAfter.label}
                />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <Image
                    src={service.image}
                    alt={`${serviceSingular(service)} project in ${city}, NC`}
                    width={1000}
                    height={750}
                    className="h-full w-full object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    quality={90}
                    priority
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {projectExample && (
          <section className="mx-auto w-full max-w-3xl px-4 pb-12 md:px-8">
            <div className="rounded-3xl border-l-4 border-amber-accent bg-white/5 p-6 md:p-8">
              <h2 className="mb-3 font-headline text-2xl text-ivory">
                What a {serviceSingular(service)} Project in {city} Looks Like
              </h2>
              <p className="text-lg leading-relaxed text-slate-300">{projectExample}</p>
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 md:p-10">
            <h2 className="mb-5 font-headline text-3xl text-ivory">
              What&apos;s Included With {service.name} in {city}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {service.bullets.map((b) => (
                <li key={b} className="flex items-start gap-3 text-slate-200">
                  <span className="mt-1 text-amber-accent">✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Recent Work</h2>
          <GalleryCarousel images={galleryImages} />
        </section>

        <QuoteCta heading={`Free ${serviceSingular(service)} Quote in ${city}`} />

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-2 font-headline text-3xl text-ivory">
              {service.name} Across {city}
            </h2>
            <div className="flex flex-wrap gap-2">
              {neighborhoods.map((place) => (
                <span key={place} className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-sm text-slate-200">
                  {place}
                </span>
              ))}
            </div>
          </div>
        </section>

        <FaqSection faqs={faqs} heading={`${service.name} in ${city}: FAQs`} />

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          {otherCoreInCity.length > 0 && (
            <>
              <h2 className="mb-6 font-headline text-3xl text-ivory">
                More Concrete Services in {city}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherCoreInCity.map((other) => (
                  <ServiceCard
                    key={other.slug}
                    href={`/${locationKey}/${other.slug}`}
                    title={`${other.name} in ${city}`}
                    blurb={other.blurb}
                  />
                ))}
              </div>
            </>
          )}

          {otherServicesElsewhere.length > 0 && (
            <>
              <h2 className="mb-6 mt-10 font-headline text-3xl text-ivory">
                Everything Else We Build
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {otherServicesElsewhere.map((other) => (
                  <ServiceCard key={other.slug} href={`/services/${other.slug}`} title={other.name} blurb={other.blurb} />
                ))}
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap gap-4 text-sm font-bold uppercase tracking-[0.12em] text-amber-accent">
            <Link href={`/${locationKey}`} className="transition hover:text-ivory">
              All concrete services in {city} →
            </Link>
            <Link href={`/services/${slug}`} className="transition hover:text-ivory">
              {service.name} overview →
            </Link>
          </div>
        </section>

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
