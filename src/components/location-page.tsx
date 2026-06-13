import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { JsonLd } from "@/components/json-ld";
import { SiteHeader } from "@/components/site-header";
import { breadcrumbSchema, serviceSchema } from "@/lib/seo";
import {
  businessName,
  coreServices,
  galleryImages,
  links,
  locations,
  phoneDisplay,
  testimonials,
  valueProps,
  type LocationKey,
} from "@/lib/site-data";

type LocationPageProps = {
  locationKey: LocationKey;
};

const processSteps = [
  {
    label: "Get Your Quote",
    body: "Give us a call or send over your address. For driveways and slabs, we can measure from satellite and text you a ballpark the same day.",
  },
  {
    label: "We Confirm On-Site",
    body: "For patios and walls, we swing by to check the base, the grading and the details, then lock in your final price in writing.",
  },
  {
    label: "We Build & Clean Up",
    body: "Our experienced crew gets the job done on schedule, cleans up after themselves, and backs the work with a warranty.",
  },
];

function SharedCtaBar() {
  return (
    <div className="flex flex-wrap gap-3">
      <a href="#quote" className="cta-primary text-base">
        Get Free Quote
      </a>
      <a href={links.call} className="cta-secondary text-base">
        Call Now
      </a>
      <a href={links.text} className="cta-secondary text-base">
        Text Now
      </a>
    </div>
  );
}

export function LocationPage({ locationKey }: LocationPageProps) {
  const location = locations[locationKey];

  return (
    <>
      <JsonLd
        data={[
          serviceSchema({
            name: `Concrete & Hardscaping in ${location.city}`,
            description: location.description,
            slug: location.key,
            url: `/${location.key}`,
          }),
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: location.city, path: `/${location.key}` },
          ]),
        ]}
      />
      <SiteHeader />

      <main className="pb-24 md:pb-0">
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
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-amber-accent">
                Serving {location.city} and surrounding areas
              </p>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-7xl">
                {location.title}
              </h1>
              <p className="mb-8 max-w-lg text-lg text-slate-300">{location.description}</p>
              <SharedCtaBar />
              <div className="mt-8 grid max-w-sm grid-cols-3 gap-3">
                <div className="stat-card text-center">
                  <p className="stat-value">4.9★</p>
                  <p className="stat-label">Rated</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value">1-3 Day</p>
                  <p className="stat-label">Installs</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value">Trusted</p>
                  <p className="stat-label">Local Crew</p>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src={location.heroImage}
                alt={`${location.city} concrete and hardscaping project`}
                width={1200}
                height={900}
                className="h-full w-full object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
            <p className="font-headline text-2xl text-amber-accent">Why Raleigh Concrete Group?</p>
            <div className="flex flex-wrap gap-4">
              {valueProps.map((point) => (
                <span key={point} className="flex items-center gap-2 text-sm font-semibold text-ivory">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-accent text-black">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 6.5" />
                    </svg>
                  </span>
                  {point}
                </span>
              ))}
            </div>
            <a href="#quote" className="cta-primary cta-sm">
              Get Quote
            </a>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <h2 className="mb-8 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {location.beforeAfterPairs.map((pair) => (
              <div key={pair.label}>
                <BeforeAfterSlider
                  beforeSrc={pair.before}
                  afterSrc={pair.after}
                  beforeAlt={`${location.city} before ${pair.label}`}
                  afterAlt={`${location.city} after ${pair.label}`}
                />
                <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {pair.label} · Drag to Compare
                </p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <a href="#quote" className="cta-primary">
              Get My Free Quote
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
              <Link
                key={service.slug}
                href={`/services/${service.slug}`}
                className="group rounded-2xl border border-amber-accent/30 bg-amber-accent/5 p-5 transition hover:-translate-y-1 hover:border-amber-accent/60 hover:bg-amber-accent/10"
              >
                <h3 className="mb-2 font-headline text-2xl text-ivory">{service.name}</h3>
                <p className="text-sm leading-relaxed text-slate-300">{service.blurb}</p>
                <span className="mt-3 inline-block text-sm font-bold uppercase tracking-[0.12em] text-amber-accent opacity-70 transition group-hover:opacity-100">
                  View {service.navLabel} →
                </span>
              </Link>
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
            <span className="text-sm font-bold text-amber-accent">4.9★ Rated</span>
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

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8" id="quote">
          <div className="rounded-3xl bg-ivory p-8 text-center text-[#2b1a12] md:p-12">
            <h2 className="mb-3 font-headline text-4xl text-[#2b1a12] md:text-5xl">
              Get Your Free {location.city} Quote
            </h2>
            <p className="mx-auto mb-7 max-w-2xl text-[#2b1a12]/80">
              Tell us a little about your project and we&apos;ll get you a price, usually the same
              day. For driveways and slabs we can often quote without coming out. Just add your
              address.
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
                {businessName} · Concrete &amp; Hardscaping · {location.city}, NC · {phoneDisplay}
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
