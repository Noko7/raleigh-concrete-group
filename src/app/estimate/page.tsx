import type { Metadata } from "next";
import Link from "next/link";

import { EstimateForm } from "@/components/estimate-form";
import { SiteHeader } from "@/components/site-header";
import { businessName, links, locationKeys, locations, phoneDisplay } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "Get a Free Estimate",
  description:
    "Request a free concrete or hardscaping estimate from Raleigh Concrete Group. Tell us about your project and we'll get back to you, usually the same day.",
  alternates: { canonical: "/estimate" },
};

export default function EstimatePage() {
  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        <section className="mx-auto w-full max-w-2xl px-4 pb-16 pt-12 md:px-8 md:pt-16">
          <div className="mb-8 text-center">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
              Free Estimate
            </span>
            <h1 className="mb-3 font-headline text-5xl text-ivory md:text-6xl">
              Request Your Free Quote
            </h1>
            <p className="mx-auto max-w-xl leading-relaxed text-slate-300">
              Tell us a little about your project and we&apos;ll get you a price, usually the same day.
              Prefer to talk now? Call or text {phoneDisplay}.
            </p>
          </div>

          <div className="rounded-3xl bg-ivory p-6 text-[#2b1a12] md:p-9">
            <EstimateForm />
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
        <a href={links.call} className="cta-primary flex-1 justify-center">Call</a>
        <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
      </div>
    </>
  );
}
