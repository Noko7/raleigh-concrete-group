import Image from "next/image";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { SiteHeader } from "@/components/site-header";
import {
  aboutParagraphs,
  businessName,
  commercialNav,
  coreServices,
  galleryImages,
  homeStats,
  links,
  locationKeys,
  locations,
  phoneDisplay,
  processSteps,
  residentialNav,
  testimonials,
  trustImage,
} from "@/lib/site-data";

// A tight, strong subset of finished work for the hero strip (kept small so the
// marquee stays light and the loop is seamless).
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
      <main className="pb-24 md:pb-0">
        {/* ── Hero ── */}
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
            <span className="mb-4 inline-block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
              Concrete &amp; Hardscaping · Raleigh, NC
            </span>
            <h1 className="mx-auto mb-5 max-w-4xl font-headline text-6xl leading-[0.92] text-ivory md:text-8xl">
              The Best Concrete Contractors in Raleigh.
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-slate-300">
              Residential and commercial concrete done right the first time: driveways, patios,
              walkways, retaining walls and pavers, built by a crew that actually shows up.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href="/#quote" className="cta-primary text-base">
                Get a Free Estimate
              </a>
              <a href={links.call} className="cta-secondary text-base">
                Call or Text {phoneDisplay}
              </a>
            </div>
          </div>
        </section>

        {/* ── Work photo strip (immediate proof, smooth auto-scroll) ── */}
        <section aria-label="Recent concrete work" className="pb-4 pt-2">
          <div className="marquee">
            <div className="marquee-track">
              {[...marqueeImages, ...marqueeImages].map((img, i) => (
                <div key={`${img.src}-${i}`} className="marquee-item" aria-hidden={i >= marqueeImages.length}>
                  <Image
                    src={img.src}
                    alt={img.alt}
                    width={384}
                    height={256}
                    sizes="(max-width: 768px) 60vw, 20rem"
                    className="marquee-img"
                    priority={i < 4}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Stat bar ── */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 md:px-8">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {homeStats.map((stat) => (
              <div key={stat.label} className="stat-card text-center">
                <p className="stat-value">{stat.value}</p>
                <p className="stat-label">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Featured services ── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
            Our Services
          </span>
          <h2 className="mb-8 font-headline text-4xl text-ivory">
            Expert Concrete Services You Can Rely On
          </h2>
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
        </section>

        {/* ── About / Welcome ── */}
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
                priority
              />
            </div>
            <div>
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
                Welcome to Raleigh Concrete Group
              </span>
              <h2 className="mb-4 font-headline text-4xl text-ivory">
                A Concrete Contractor You Can Actually Trust
              </h2>
              {aboutParagraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 24)} className="mb-4 leading-relaxed text-slate-300">
                  {paragraph}
                </p>
              ))}
              <a href="/#quote" className="cta-primary mt-2">
                Get My Free Estimate
              </a>
            </div>
          </div>
        </section>

        {/* ── Before / After ── */}
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
        </section>

        {/* ── What to Expect ── */}
        <section className="border-y border-white/10 bg-black/20">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
            <div className="mb-3 text-center">
              <span className="text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
                Simple &amp; Stress-Free
              </span>
              <h2 className="mt-2 font-headline text-4xl text-ivory">What to Expect</h2>
            </div>
            <p className="mx-auto mb-12 max-w-2xl text-center leading-relaxed text-slate-300">
              Getting started is easy. Here&apos;s exactly how we take your project from first call to
              finished concrete.
            </p>
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
              <a href="/#quote" className="cta-primary">
                Start My Free Estimate
              </a>
            </div>
          </div>
        </section>

        {/* ── Residential & Commercial ── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <h2 className="mb-2 font-headline text-4xl text-ivory">
            Services We Offer Across the Triangle
          </h2>
          <p className="mb-8 max-w-2xl leading-relaxed text-slate-300">
            From home upgrades to commercial flatwork, we handle a wide range of concrete and
            hardscaping projects. We&apos;ll help you choose the right option during your free quote.
          </p>
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

        {/* ── Testimonials ── */}
        <section id="reviews" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pb-14 md:px-8">
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

        {/* ── Final CTA ── */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <div className="rounded-3xl bg-ivory p-8 text-center text-[#2b1a12] md:p-12">
            <h2 className="mb-3 font-headline text-4xl text-[#2b1a12] md:text-5xl">
              Get Your Free Concrete Estimate
            </h2>
            <p className="mx-auto mb-7 max-w-2xl text-[#2b1a12]/80">
              Tell us a little about your project and we&apos;ll get you a price, usually the same day.
              For driveways and slabs we can often quote without coming out. Just add your address.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="/#quote" className="rounded-full bg-[#2b1a12] px-7 py-3.5 text-base font-bold text-white transition hover:bg-[#3a241a]">
                Get a Free Estimate
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
        <a href="/#quote" className="cta-primary flex-1 justify-center">Free Estimate</a>
        <a href={links.call} className="cta-secondary flex-1 justify-center">Call</a>
        <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
      </div>
    </>
  );
}
