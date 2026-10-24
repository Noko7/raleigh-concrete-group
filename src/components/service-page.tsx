import Image from "next/image";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaqSection } from "@/components/faq-section";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { JsonLd } from "@/components/json-ld";
import { CtaButtons, MobileBar, QUOTE_CTA, QuoteCta, ServiceCard, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import { breadcrumbSchema, faqSchema, serviceSchema } from "@/lib/seo";
import {
  clipboardImage,
  commercialServiceSlugs,
  coreServices,
  galleryImages,
  getService,
  getServiceFaqs,
  links,
  type Service,
  serviceSingular,
} from "@/lib/site-data";

export function ServicePage({ service }: { service: Service }) {
  // Never show the same image for hero and showcase.
  const showcaseFallbacks = [
    "/images/servicing-to-client-image.png",
    "/images/workers_pouring_driveway_live_action.png",
    "/images/front_walkway+driveway.png",
  ];
  const secondaryShowcaseImage =
    service.showcaseImage && service.showcaseImage !== service.image
      ? service.showcaseImage
      : showcaseFallbacks.find((src) => src !== service.image) ??
        showcaseFallbacks[0];
  const isCommercial = commercialServiceSlugs.has(service.slug);
  const faqs = getServiceFaqs(service.slug);
  const otherServices = isCommercial
    ? Array.from(commercialServiceSlugs)
        .filter((slug) => slug !== service.slug)
        .map((slug) => getService(slug))
        .filter((s): s is Service => Boolean(s))
    : coreServices.filter((s) => s.slug !== service.slug);

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({
            name: `${service.name} in Raleigh, NC`,
            serviceType: service.name,
            description: service.blurb,
            slug: service.slug,
            image: service.image,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: service.name, path: `/services/${service.slug}` },
          ]),
          faqSchema(faqs),
        ]}
      />
      <SiteHeader activeService={service.slug} />

      <main>
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: service.name, path: `/services/${service.slug}` },
          ]}
        />
        <section className="relative overflow-hidden py-12 md:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-7xl">
                {service.name}
              </h1>
              <p className="mb-8 max-w-lg text-lg text-slate-300">{service.intro}</p>
              <CtaButtons />
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src={service.image}
                alt={`${service.name} in Raleigh, NC`}
                width={1200}
                height={900}
                className="h-full w-full object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                quality={90}
                priority
              />
            </div>
          </div>
        </section>

        {isCommercial && (
          <section className="mx-auto w-full max-w-6xl px-4 pb-6 md:px-8">
            <div className="grid items-center gap-6 rounded-2xl border border-white/10 bg-white/5 p-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-white/10">
                <Image
                  src={clipboardImage}
                  alt="Raleigh Concrete Group estimator with clipboard discussing a commercial scope"
                  width={1000}
                  height={750}
                  className="h-full w-full object-cover"
                  quality={90}
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
              <div>
                <h2 className="mb-3 font-headline text-3xl text-ivory">Clear Scope. Clear Pricing.</h2>
                <p className="text-slate-300">
                  Every commercial quote includes a clear scope, schedule expectations, and a direct
                  point of contact so your team knows exactly what to expect on site.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto w-full max-w-6xl px-4 py-12 md:px-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="mb-5 font-headline text-4xl text-ivory">What You Get</h2>
              <ul className="flex flex-col gap-3">
                {service.bullets.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-slate-200">
                    <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-accent text-black">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                        <path d="m5 12.5 4.5 4.5L19 6.5" />
                      </svg>
                    </span>
                    <span className="text-base">{point}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                <a href={links.quote} className="cta-primary">
                  {QUOTE_CTA}
                </a>
              </div>
            </div>

            {service.beforeAfter ? (
              <BeforeAfterSlider
                beforeSrc={service.beforeAfter.before}
                afterSrc={service.beforeAfter.after}
                beforeAlt={`Raleigh ${service.name} before`}
                afterAlt={`Raleigh ${service.name} after`}
                label={service.beforeAfter.label}
              />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <Image
                  src={secondaryShowcaseImage}
                  alt={`${serviceSingular(service)} project in Raleigh`}
                  width={1000}
                  height={750}
                  className="h-full w-full object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  quality={90}
                />
              </div>
            )}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Recent Work</h2>
          <GalleryCarousel images={galleryImages} />
        </section>

        <QuoteCta heading={`Get Your Free ${serviceSingular(service)} Quote`} />

        <FaqSection faqs={faqs} heading={`${service.name} FAQs`} />

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-3xl text-ivory">Other Services We Offer</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherServices.map((other) => (
              <ServiceCard key={other.slug} href={`/services/${other.slug}`} title={other.name} blurb={other.blurb} />
            ))}
          </div>
        </section>

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
