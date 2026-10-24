import Link from "next/link";

import { businessName, links, locationKeys, locations, phoneDisplay } from "@/lib/site-data";

// The pieces every marketing page shares. One copy each, so a label or link changes in one place.
// Any link to `#quote` opens the quote modal (QuoteModalRoot catches the click).

export const QUOTE_CTA = "Get a Free Quote";

/** Quote, call and text, side by side. The hero's buttons. */
export function CtaButtons() {
  return (
    <div className="flex flex-wrap gap-3">
      <a href={links.quote} className="cta-primary text-base">
        {QUOTE_CTA}
      </a>
      <a href={links.call} className="cta-secondary text-base">
        Call {phoneDisplay}
      </a>
      <a href={links.text} className="cta-secondary text-base">
        Text Us
      </a>
    </div>
  );
}

/** The closing ivory block. The heading carries the page's own wording; the buttons are the same everywhere. */
export function QuoteCta({ heading }: { heading: string }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8" id="quote">
      <div className="rounded-3xl bg-ivory p-8 text-center text-[#2b1a12] md:p-12">
        <h2 className="mb-7 font-headline text-4xl text-[#2b1a12] md:text-5xl">{heading}</h2>
        <div className="flex flex-wrap justify-center gap-3">
          <a href={links.quote} className="rounded-full bg-[#2b1a12] px-7 py-3.5 text-base font-bold text-white transition hover:bg-[#3a241a]">
            {QUOTE_CTA}
          </a>
          <a href={links.call} className="rounded-full border-2 border-[#2b1a12] px-7 py-3.5 text-base font-bold text-[#2b1a12]">
            Call {phoneDisplay}
          </a>
          <a href={links.text} className="rounded-full border-2 border-[#2b1a12] px-7 py-3.5 text-base font-bold text-[#2b1a12]">
            Text Us
          </a>
        </div>
      </div>
    </section>
  );
}

/** A service tile. The whole card is the link, so it needs no "View details" line to say so. */
export function ServiceCard({
  href,
  title,
  blurb,
  featured = false,
}: {
  href: string;
  title: string;
  blurb: string;
  /** Amber tint, for the core services. */
  featured?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        featured
          ? "group rounded-2xl border border-amber-accent/30 bg-amber-accent/5 p-5 transition hover:-translate-y-1 hover:border-amber-accent/60 hover:bg-amber-accent/10"
          : "group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:-translate-y-1 hover:border-amber-accent/50 hover:bg-white/10"
      }
    >
      <h3 className="mb-2 font-headline text-2xl text-ivory">
        {title} <span className="text-amber-accent opacity-70 transition group-hover:opacity-100" aria-hidden="true">→</span>
      </h3>
      <p className="text-sm leading-relaxed text-slate-300">{blurb}</p>
    </Link>
  );
}

/** City links (internal links to every location page), the name, the phone and the privacy policy. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-black/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
        <nav aria-label="Areas we serve" className="mb-5 flex flex-wrap gap-x-4 gap-y-2">
          {locationKeys.map((key) => (
            <Link key={key} href={`/${key}`} className="text-sm font-semibold text-slate-300 transition hover:text-amber-accent">
              {locations[key].city}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
          <span className="font-headline text-2xl text-ivory">{businessName}</span>
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
            <a href={links.call} className="transition hover:text-amber-accent">
              {phoneDisplay}
            </a>
            <Link href="/privacy-policy" className="transition hover:text-amber-accent">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Phone-only bar pinned to the bottom of every marketing page. */
export function MobileBar() {
  return (
    <div className="mobile-bar">
      <a href={links.quote} className="cta-primary flex-1 justify-center">Free Quote</a>
      <a href={links.call} className="cta-secondary flex-1 justify-center">Call</a>
      <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
    </div>
  );
}
