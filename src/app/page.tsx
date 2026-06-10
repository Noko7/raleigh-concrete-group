import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { GalleryCarousel } from "@/components/gallery-carousel";
import { QuoteForm } from "@/components/quote-form";
import { SiteHeader } from "@/components/site-header";
import {
  businessName,
  concreteServices,
  coreServices,
  galleryImages,
  hardscapingServices,
  links,
  locationKeys,
  locations,
  phoneDisplay,
  testimonials,
  valueProps,
} from "@/lib/site-data";

const homeBeforeAfter = [
  {
    before: "/images/before_driveway.png",
    after: "/images/after_driveway.png",
    label: "Driveway Replacement",
  },
  {
    before: "/images/back_patio_before.png",
    after: "/images/back_patio_after.png",
    label: "Backyard Patio",
  },
];

export default function Home() {
  const menuServices = [...concreteServices, ...hardscapingServices];

  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        {/* Hero */}
        <section className="relative overflow-hidden pb-6 pt-12 md:pt-16">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(194,104,42,0.18),transparent_45%)]" />
          <div className="relative mx-auto max-w-6xl px-4 text-center md:px-8">
            <span className="mb-4 inline-block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
              Concrete &amp; Hardscaping · Raleigh, NC
            </span>
            <h1 className="mx-auto mb-5 max-w-4xl font-headline text-6xl leading-[0.92] text-ivory md:text-8xl">
              Concrete That&apos;s Built to Last.
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-slate-300">
              Driveways, patios, walkways, retaining walls and pavers, done right the first time by a
              crew that actually shows up. Get a free quote, usually the same day.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href="#quote" className="cta-primary text-base">
                Get Free Quote
              </a>
              <a href={links.call} className="cta-secondary text-base">
                Call {phoneDisplay}
              </a>
            </div>
          </div>
        </section>

        {/* Gallery */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">Recent Work in Raleigh</h2>
          <GalleryCarousel images={galleryImages} />
        </section>

        {/* Before / After */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {homeBeforeAfter.map((pair) => (
              <div key={pair.label}>
                <BeforeAfterSlider
                  beforeSrc={pair.before}
                  afterSrc={pair.after}
                  beforeAlt={`Raleigh ${pair.label} before`}
                  afterAlt={`Raleigh ${pair.label} after`}
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

        {/* Value bar */}
        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
            <p className="font-headline text-2xl text-amber-accent">Why Raleigh Concrete Group?</p>
            <div className="flex flex-wrap gap-4">
              {valueProps.map((point) => (
                <span key={point} className="flex items-center gap-2 text-sm font-semibold text-ivory">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-accent text-[10px] font-black text-black">
                    ✓
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

        {/* Core services */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
            Our Services
          </span>
          <h2 className="mb-8 font-headline text-4xl text-ivory">What We Build</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {coreServices.map((service) => (
              <Link
                key={service.slug}
                href={`/services/${service.slug}`}
                className="group rounded-2xl border border-amber-accent/30 bg-amber-accent/5 p-6 transition hover:-translate-y-1 hover:border-amber-accent/60 hover:bg-amber-accent/10"
              >
                <h3 className="mb-2 font-headline text-2xl text-ivory">{service.name}</h3>
                <p className="text-sm leading-relaxed text-slate-300">{service.blurb}</p>
                <span className="mt-4 inline-block text-sm font-bold uppercase tracking-[0.12em] text-amber-accent opacity-70 transition group-hover:opacity-100">
                  View {service.navLabel} →
                </span>
              </Link>
            ))}
          </div>

          {/* Full menu */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="mb-4 font-headline text-2xl text-ivory">More Concrete &amp; Hardscaping</h3>
            <div className="flex flex-wrap gap-2">
              {menuServices.map((service) => (
                <Link
                  key={service.slug}
                  href={`/services/${service.slug}`}
                  className="rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-accent/60 hover:text-ivory"
                >
                  {service.name}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
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

        {/* Quote */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8" id="quote">
          <div className="rounded-3xl bg-ivory p-6 text-[#2b1a12] md:p-10">
            <h2 className="mb-2 font-headline text-4xl text-[#2b1a12] md:text-5xl">
              Get Your Free Concrete Quote
            </h2>
            <p className="mb-6 max-w-2xl text-[#2b1a12]/80">
              Tell us a little about your project and we&apos;ll get you a price, usually the same day.
              For driveways and slabs we can often quote without coming out. Just add your address.
            </p>
            <div className="mb-6 flex flex-wrap gap-2">
              <a href={links.call} className="rounded-full bg-[#2b1a12] px-5 py-2.5 text-sm font-bold text-white">
                Call Now
              </a>
              <a href={links.text} className="rounded-full border-2 border-[#2b1a12] px-5 py-2.5 text-sm font-bold text-[#2b1a12]">
                Text Now
              </a>
            </div>
            <QuoteForm />
          </div>
        </section>

        <footer className="border-t border-white/10 bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="mr-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                Serving:
              </span>
              {locationKeys.map((key) => (
                <Link
                  key={key}
                  href={`/${key}`}
                  className="text-sm font-semibold text-slate-300 transition hover:text-amber-accent"
                >
                  {locations[key].city}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
              <span className="font-headline text-2xl text-ivory">{businessName}</span>
              <p className="text-right text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                {businessName} · Concrete &amp; Hardscaping · {phoneDisplay}
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
