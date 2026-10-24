import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { HeroMarquee } from "@/components/hero-marquee";
import { MobileBar, QUOTE_CTA, QuoteCta, ServiceCard, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import {
  aboutParagraphs,
  commercialNav,
  coreServices,
  galleryImages,
  homeStats,
  links,
  phoneDisplay,
  processSteps,
  residentialNav,
  testimonials,
  trustImage,
} from "@/lib/site-data";

export const metadata: Metadata = {
  // The money keyword, not the brand, leads the homepage title.
  title: { absolute: "Raleigh Concrete Contractors | Driveways, Patios & Stamped Concrete" },
  description:
    "Top-rated concrete contractors in Raleigh, NC. We pour driveways, patios, walkways, retaining walls, stamped concrete and pavers across the Triangle. Free written quotes.",
  alternates: { canonical: "/" },
};

// Kept small so the marquee stays light.
const marqueeImages = galleryImages.slice(0, 14);

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
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden pb-6 pt-12 md:pt-16">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(194,104,42,0.18),transparent_45%)]" />
          <div className="relative mx-auto max-w-6xl px-4 text-center md:px-8">
            <Image
              src="/images/logo_horizontal_light.png"
              alt="Raleigh Concrete Group"
              width={967}
              height={243}
              priority
              className="mx-auto mb-6 h-auto w-auto max-w-[280px] drop-shadow-lg md:max-w-[440px]"
            />
            <h1 className="mx-auto mb-5 max-w-4xl font-headline text-6xl leading-[0.92] text-ivory md:text-8xl">
              Raleigh Concrete Contractors.
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-slate-300">
              Driveways, patios, walkways, retaining walls and pavers for homes and businesses
              across the Triangle.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href={links.quote} className="cta-primary text-base">
                {QUOTE_CTA}
              </a>
              <a href={links.call} className="cta-secondary text-base">
                Call or Text {phoneDisplay}
              </a>
            </div>
          </div>
        </section>

        <section aria-label="Recent concrete work" className="pb-4 pt-2">
          <HeroMarquee images={marqueeImages} />
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {homeBeforeAfter.map((pair) => (
              <BeforeAfterSlider
                key={pair.label}
                beforeSrc={pair.before}
                afterSrc={pair.after}
                beforeAlt={`Raleigh ${pair.label} before`}
                afterAlt={`Raleigh ${pair.label} after`}
                label={pair.label}
              />
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-8">
          <div className="grid grid-cols-3 gap-3">
            {homeStats.map((stat) => (
              <div key={stat.label} className="stat-card text-center">
                <p className="stat-value">{stat.value}</p>
                <p className="stat-label">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="about" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-12 md:px-8">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src={trustImage}
                alt="A Raleigh Concrete Group team member walking a homeowner through their free estimate"
                width={1200}
                height={900}
                className="h-full w-full object-cover"
                sizes="(max-width: 768px) 100vw, 50vw"
                quality={90}
                priority
              />
            </div>
            <div>
              <h2 className="mb-4 font-headline text-4xl text-ivory">
                A Concrete Contractor You Can Actually Trust
              </h2>
              {aboutParagraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} className="mb-4 leading-relaxed text-slate-300">
                  {paragraph}
                </p>
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <a href={links.quote} className="cta-primary">
                  {QUOTE_CTA}
                </a>
                <Link
                  href="/about"
                  className="text-sm font-bold uppercase tracking-[0.12em] text-amber-accent transition hover:text-ivory"
                >
                  More About Us →
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
            <h2 className="mb-10 text-center font-headline text-4xl text-ivory">What to Expect</h2>
            <div className="grid gap-6 md:grid-cols-3">
              {processSteps.map((step, i) => (
                <div key={step.title} className="process-step">
                  <span className="process-num">{i + 1}</span>
                  <h3 className="process-title">{step.title}</h3>
                  <p className="process-body">{step.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 text-center">
              <a href={links.quote} className="cta-primary">
                {QUOTE_CTA}
              </a>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <h2 className="mb-8 font-headline text-4xl text-ivory">
            Services We Offer Across the Triangle
          </h2>
          {/* Core services get a card; everything else is a chip under Residential or Commercial. */}
          <div className="mb-6 grid gap-5 md:grid-cols-3">
            {coreServices.map((service) => (
              <ServiceCard
                key={service.slug}
                href={`/services/${service.slug}`}
                title={service.name}
                blurb={service.blurb}
                featured
              />
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="mb-4 font-headline text-2xl text-amber-accent">Residential Services</h3>
              <div className="flex flex-wrap gap-2">
                {residentialNav.map((item) => (
                  <Link
                    key={`res-${item.slug}-${item.label}`}
                    href={`/services/${item.slug}`}
                    className="rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-accent/60 hover:text-ivory"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="mb-4 font-headline text-2xl text-amber-accent">Commercial Services</h3>
              <div className="flex flex-wrap gap-2">
                {commercialNav.map((item) => (
                  <Link
                    key={`com-${item.slug}-${item.label}`}
                    href={`/services/${item.slug}`}
                    className="rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-accent/60 hover:text-ivory"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="reviews" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pb-14 md:px-8">
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

        <QuoteCta heading="Get Your Free Concrete Quote" />

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
