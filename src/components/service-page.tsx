import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { SiteHeader } from "@/components/site-header";
import {
  businessName,
  coreServices,
  galleryImages,
  links,
  phoneDisplay,
  type Service,
} from "@/lib/site-data";

function CtaBar() {
  return (
    <div className="flex flex-wrap gap-3">
      <a href="#quote" className="cta-primary text-base">
        Get Free Quote
      </a>
      <a href={links.call} className="cta-secondary text-base">
        Call {phoneDisplay}
      </a>
      <a href={links.text} className="cta-secondary text-base">
        Text Now
      </a>
    </div>
  );
}

export function ServicePage({ service }: { service: Service }) {
  const otherServices = coreServices.filter((s) => s.slug !== service.slug);

  return (
    <>
      <SiteHeader activeService={service.slug} />

      <main className="pb-24 md:pb-0">
        {/* Hero */}
        <section className="relative overflow-hidden py-12 md:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-amber-accent">
                Concrete Raleigh
              </p>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-7xl">
                {service.name}
              </h1>
              <p className="mb-8 max-w-lg text-lg text-slate-300">{service.intro}</p>
              <CtaBar />
              <div className="mt-8 grid max-w-sm grid-cols-3 gap-3">
                <div className="stat-card text-center">
                  <p className="stat-value">4.9★</p>
                  <p className="stat-label">Rated</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value">Same Day</p>
                  <p className="stat-label">Quotes</p>
                </div>
                <div className="stat-card text-center">
                  <p className="stat-value">Insured</p>
                  <p className="stat-label">& Licensed</p>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src={service.image}
                alt={`${service.name} in Raleigh, NC`}
                width={1200}
                height={900}
                className="h-full w-full object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
            </div>
          </div>
        </section>

        {/* What you get */}
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
                <a href="#quote" className="cta-primary">
                  Get My Free Quote
                </a>
              </div>
            </div>

            {service.beforeAfter ? (
              <div>
                <BeforeAfterSlider
                  beforeSrc={service.beforeAfter.before}
                  afterSrc={service.beforeAfter.after}
                  beforeAlt={`Raleigh ${service.name} before`}
                  afterAlt={`Raleigh ${service.name} after`}
                />
                <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {service.beforeAfter.label} · Drag to Compare
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <Image
                  src={service.image}
                  alt={`${service.name} project in Raleigh`}
                  width={1000}
                  height={750}
                  className="h-full w-full object-cover"
                  sizes="(max-width: 1024px) 100vw, 50vw"
                />
              </div>
            )}
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
              Get Your Free {service.name} Quote
            </h2>
            <p className="mx-auto mb-7 max-w-2xl text-[#2b1a12]/80">
              Tell us a little about your project and we&apos;ll get you a price, usually the same day.
              For driveways and slabs we can often quote without coming out. Just add your address.
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

        {/* Other services */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-3xl text-ivory">Other Services We Offer</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherServices.map((other) => (
              <Link
                key={other.slug}
                href={`/services/${other.slug}`}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:-translate-y-1 hover:border-amber-accent/50 hover:bg-white/10"
              >
                <h3 className="mb-2 font-headline text-2xl text-ivory">{other.name}</h3>
                <p className="text-sm leading-relaxed text-slate-300">{other.blurb}</p>
                <span className="mt-3 inline-block text-sm font-bold uppercase tracking-[0.12em] text-amber-accent opacity-70 transition group-hover:opacity-100">
                  View Details →
                </span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="border-t border-white/10 bg-black/20">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-8 md:px-8">
            <span className="font-headline text-2xl text-ivory">{businessName}</span>
            <p className="text-right text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
              {businessName} · Concrete &amp; Hardscaping · {phoneDisplay}
            </p>
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
