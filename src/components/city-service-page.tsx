import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaqSection } from "@/components/faq-section";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { JsonLd } from "@/components/json-ld";
import { SiteHeader } from "@/components/site-header";
import { breadcrumbSchema, faqSchema, serviceSchema } from "@/lib/seo";
import {
  businessName,
  cityServiceSlugs,
  galleryImages,
  getCityServiceContent,
  getService,
  links,
  phoneDisplay,
  type LocationKey,
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
  const { service, city, neighborhoods, paragraphs, faqs } = content;

  const otherCoreInCity = cityServiceSlugs
    .filter((s) => s !== slug)
    .map((s) => getService(s))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

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

      <main className="pb-24 md:pb-0">
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: city, path: `/${locationKey}` },
            { name: service.name, path: `/${locationKey}/${slug}` },
          ]}
        />

        {/* Hero */}
        <section className="relative overflow-hidden py-12 md:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-amber-accent">
                Serving {city}, NC
              </p>
              <h1 className="mb-5 font-headline text-4xl leading-[1] text-ivory md:text-6xl">
                {content.heading}
              </h1>
              {paragraphs.map((p) => (
                <p key={p.slice(0, 24)} className="mb-4 max-w-lg text-lg leading-relaxed text-slate-300">
                  {p}
                </p>
              ))}
              <div className="mt-2 flex flex-wrap gap-3">
                <a href="#quote" className="cta-primary text-base">
                  Get Free Quote
                </a>
                <a href={links.call} className="cta-secondary text-base">
                  Call {phoneDisplay}
                </a>
              </div>
            </div>
            <div>
              {service.beforeAfter ? (
                <div>
                  <BeforeAfterSlider
                    beforeSrc={service.beforeAfter.before}
                    afterSrc={service.beforeAfter.after}
                    beforeAlt={`${service.name} in ${city} before`}
                    afterAlt={`${service.name} in ${city} after`}
                  />
                  <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {service.beforeAfter.label} · Drag to Compare
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <Image
                    src={service.image}
                    alt={`${service.name} project in ${city}, NC`}
                    width={1000}
                    height={750}
                    className="h-full w-full object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    priority
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* What's included */}
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

        {/* Gallery */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Recent Work</h2>
          <GalleryCarousel images={galleryImages} />
        </section>

        {/* Quote */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8" id="quote">
          <div className="rounded-3xl bg-ivory p-8 text-center text-[#2b1a12] md:p-12">
            <h2 className="mb-3 font-headline text-4xl text-[#2b1a12] md:text-5xl">
              Free {service.name} Quote in {city}
            </h2>
            <p className="mx-auto mb-7 max-w-2xl text-[#2b1a12]/80">
              Tell us a little about your project and we&apos;ll get you a price, usually the same day.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="#quote" className="rounded-full bg-[#2b1a12] px-7 py-3.5 text-base font-bold text-white transition hover:bg-[#3a241a]">
                Get My Free Quote
              </a>
              <a href={links.call} className="rounded-full border-2 border-[#2b1a12] px-7 py-3.5 text-base font-bold text-[#2b1a12]">
                Call Now
              </a>
              <a href={links.text} className="rounded-full border-2 border-[#2b1a12] px-7 py-3.5 text-base font-bold text-[#2b1a12]">
                Text Now
              </a>
            </div>
          </div>
        </section>

        {/* Areas served */}
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

        {/* FAQ */}
        <FaqSection faqs={faqs} heading={`${service.name} in ${city}: FAQs`} />

        {/* Cross-links: other services in this city */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-3xl text-ivory">
            More Concrete Services in {city}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherCoreInCity.map((other) => (
              <Link
                key={other.slug}
                href={`/${locationKey}/${other.slug}`}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:-translate-y-1 hover:border-amber-accent/50 hover:bg-white/10"
              >
                <h3 className="mb-2 font-headline text-2xl text-ivory">
                  {other.name} in {city}
                </h3>
                <p className="text-sm leading-relaxed text-slate-300">{other.blurb}</p>
                <span className="mt-3 inline-block text-sm font-bold uppercase tracking-[0.12em] text-amber-accent opacity-70 transition group-hover:opacity-100">
                  View Details →
                </span>
              </Link>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-4 text-sm font-bold uppercase tracking-[0.12em] text-amber-accent">
            <Link href={`/${locationKey}`} className="transition hover:text-ivory">
              All concrete services in {city} →
            </Link>
            <Link href={`/services/${slug}`} className="transition hover:text-ivory">
              {service.name} overview →
            </Link>
          </div>
        </section>

        <footer className="border-t border-white/10 bg-black/20">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-8 md:px-8">
            <span className="font-headline text-2xl text-ivory">{businessName}</span>
            <div className="flex flex-col items-end gap-1">
              <Link
                href="/privacy-policy"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 transition hover:text-amber-accent"
              >
                Privacy Policy
              </Link>
              <p className="text-right text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                {businessName} &middot; Concrete &amp; Hardscaping &middot; {city}, NC &middot; {phoneDisplay}
              </p>
            </div>
          </div>
        </footer>
      </main>

      <div className="mobile-bar">
        <a href="#quote" className="cta-primary flex-1 justify-center">Free Quote</a>
        <a href={links.call} className="cta-secondary flex-1 justify-center">Call</a>
        <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
      </div>
    </>
  );
}
