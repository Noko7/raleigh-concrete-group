import type { Metadata } from "next";
import Link from "next/link";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { GalleryGrid } from "@/components/gallery-grid";
import { SiteHeader } from "@/components/site-header";
import {
  businessName,
  galleryImages,
  links,
  locationKeys,
  locations,
  phoneDisplay,
  sharedBeforeAfter,
} from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Gallery | Recent Concrete & Hardscaping Work",
  description:
    "Browse recent concrete driveways, patios, walkways, retaining walls and paver projects completed across Raleigh and the Triangle. Click any photo to view it full size.",
  alternates: { canonical: "/gallery" },
};

export default function GalleryPage() {
  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 md:px-8 md:pt-16">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
            Our Work
          </span>
          <h1 className="mb-4 font-headline text-5xl text-ivory md:text-6xl">Recent Work in Raleigh</h1>
          <p className="max-w-2xl leading-relaxed text-slate-300">
            A look at concrete and hardscaping projects we&apos;ve finished around the Triangle. Tap any
            photo to open it full size.
          </p>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <GalleryGrid images={galleryImages} />
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {sharedBeforeAfter.map((pair) => (
              <div key={pair.label}>
                <BeforeAfterSlider
                  beforeSrc={pair.before}
                  afterSrc={pair.after}
                  beforeAlt={`Raleigh ${pair.label} before`}
                  afterAlt={`Raleigh ${pair.label} after`}
                />
                <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {pair.label} &middot; Drag to Compare
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-8" id="quote">
          <div className="rounded-3xl bg-ivory p-8 text-center text-[#2b1a12] md:p-12">
            <h2 className="mb-3 font-headline text-4xl text-[#2b1a12] md:text-5xl">
              Like What You See?
            </h2>
            <p className="mx-auto mb-7 max-w-2xl text-[#2b1a12]/80">
              Tell us about your project and we&apos;ll get you a price, usually the same day.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="/#quote" className="rounded-full bg-[#2b1a12] px-7 py-3.5 text-base font-bold text-white transition hover:bg-[#3a241a]">
                Get a Free Estimate
              </a>
              <a href={links.call} className="rounded-full border-2 border-[#2b1a12] px-7 py-3.5 text-base font-bold text-[#2b1a12]">
                Call Now
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
              <div className="flex flex-col items-start gap-1 md:items-end">
                <Link
                  href="/privacy-policy"
                  className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 transition hover:text-amber-accent"
                >
                  Privacy Policy
                </Link>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 md:text-right">
                  {businessName} &middot; Concrete &amp; Hardscaping &middot; {phoneDisplay}
                </p>
              </div>
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
