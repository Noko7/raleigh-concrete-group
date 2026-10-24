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
  coreServices,
  galleryImages,
  getLocationFaqs,
  links,
  locations,
  testimonials,
  type LocationKey,
} from "@/lib/site-data";

type LocationPageProps = {
  locationKey: LocationKey;
};

const processSteps = [
  {
    label: "Get Your Quote",
    body: "Give us a call or send over your address. For driveways and slabs, we can measure from satellite and text you a ballpark without a visit.",
  },
  {
    label: "We Confirm On-Site",
    body: "For patios and walls, we swing by to check the base, the grading and the details, then lock in your final price in writing.",
  },
  {
    label: "We Build & Clean Up",
    body: "Our experienced crew gets the job done on schedule, cleans up after themselves, and treats your property like it's our own.",
  },
];

export function LocationPage({ locationKey }: LocationPageProps) {
  const location = locations[locationKey];
  const faqs = getLocationFaqs(location.city);

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({
            name: `Concrete & Hardscaping in ${location.city}, NC`,
            serviceType: "Concrete & Hardscaping",
            description: location.description,
            slug: location.key,
            url: `/${location.key}`,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: location.city, path: `/${location.key}` },
          ]),
          faqSchema(faqs),
        ]}
      />
      <SiteHeader />

      <main>
        <Breadcrumbs
          items={[
            { name: "Home", path: "/" },
            { name: location.city, path: `/${location.key}` },
          ]}
        />
        <section className="relative overflow-hidden py-14 md:py-20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-7xl">
                {location.title}
              </h1>
              <p className="mb-8 max-w-lg text-lg text-slate-300">{location.description}</p>
              <CtaButtons />
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src={location.heroImage}
                alt={`${location.city} concrete and hardscaping project`}
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

        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <h2 className="mb-8 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {location.beforeAfterPairs.map((pair) => (
              <BeforeAfterSlider
                key={pair.label}
                beforeSrc={pair.before}
                afterSrc={pair.after}
                beforeAlt={`${location.city} before ${pair.label}`}
                afterAlt={`${location.city} after ${pair.label}`}
                label={pair.label}
              />
            ))}
          </div>
          <div className="mt-8 text-center">
            <a href={links.quote} className="cta-primary">
              {QUOTE_CTA}
            </a>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Project Gallery</h2>
          <GalleryCarousel images={galleryImages} />
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Concrete Services in {location.city}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {coreServices.map((service) => (
              <ServiceCard
                key={service.slug}
                href={`/${location.key}/${service.slug}`}
                title={`${service.name} in ${location.city}`}
                blurb={service.blurb}
                featured
              />
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">How It Works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {processSteps.map((step, index) => (
              <article key={step.label} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <p className="mb-3 font-headline text-5xl text-amber-accent">{index + 1}</p>
                <h3 className="mb-2 font-headline text-2xl text-ivory">{step.label}</h3>
                <p className="text-sm text-slate-300">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 className="font-headline text-4xl text-ivory">What Customers Say</h2>
            <span className="text-sm font-bold text-amber-accent">5.0★ on Google</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {testimonials.slice(0, 3).map((item) => (
              <blockquote key={`${item.name}-${item.city}`} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <p className="mb-4 text-slate-100">&ldquo;{item.quote}&rdquo;</p>
                <footer className="text-sm font-semibold text-slate-300">
                  {item.name} · {item.city}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>

        <QuoteCta heading={`Get Your Free ${location.city} Quote`} />

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-2 font-headline text-3xl text-ivory">Areas We Serve Near {location.city}</h2>
            <div className="flex flex-wrap gap-2">
              {location.neighborhoods.map((place) => (
                <span key={place} className="rounded-full border border-white/15 bg-black/30 px-3 py-1 text-sm text-slate-200">
                  {place}
                </span>
              ))}
            </div>
          </div>
        </section>

        <FaqSection faqs={faqs} heading={`Concrete in ${location.city}: FAQs`} />

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
