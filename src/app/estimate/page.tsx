import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import {
  businessName,
  links,
  phoneDisplay,
  processSteps,
} from "@/lib/site-data";

const estimateStats = [
  { value: "4.9★", label: "Google Rated" },
  { value: "Same-Day", label: "Response" },
  { value: "60 Sec", label: "Quick Form" },
  { value: "Clear", label: "Written Price" },
];

export const metadata: Metadata = {
  title: "Get a Free Concrete Estimate in Raleigh",
  description:
    "Request a free, no-obligation concrete estimate from Raleigh Concrete Group. Tell us about your driveway, patio, walkway or commercial project and we'll get you a price, usually the same day.",
  alternates: { canonical: "/estimate" },
};

export default function EstimatePage() {
  return (
    <>
      <SiteHeader />
      <main className="pb-24 md:pb-0">
        {/* ── Hero / request ── */}
        <section className="relative overflow-hidden pb-10 pt-12 md:pt-16">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_25%_25%,rgba(194,104,42,0.2),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="mb-3 inline-block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
                Free · No Obligation
              </span>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-7xl">
                Get Your Free Concrete Estimate
              </h1>
              <p className="mb-7 max-w-lg text-lg leading-relaxed text-slate-300">
                Tell us about your project and we&apos;ll get you a clear, written price, usually the
                same day. For driveways and slabs we can often quote from satellite imagery without
                ever coming out.
              </p>
              <a href="/#quote" className="cta-primary mb-4 w-full max-w-sm justify-center text-base sm:w-auto">
                Start My 60-Second Quote
              </a>
              <p className="text-sm text-slate-400">
                Most homeowners finish this in under 1 minute.
              </p>
              <div className="grid max-w-md grid-cols-2 gap-3 sm:grid-cols-4">
                {estimateStats.map((stat) => (
                  <div key={stat.label} className="stat-card text-center">
                    <p className="stat-value text-xl">{stat.value}</p>
                    <p className="stat-label">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Start card */}
            <div className="rounded-3xl border border-amber-accent/30 bg-white/5 p-7 md:p-8">
              <h2 className="mb-2 font-headline text-3xl text-ivory">Ready for Your Price?</h2>
              <p className="mb-6 text-slate-300">
                Use the quick form to upload photos and share your address. We&apos;ll review and send
                your estimate fast.
              </p>
              <a href="/#quote" className="cta-primary mb-3 w-full justify-center text-base">
                Open Quick Quote Form
              </a>
              <p className="mb-5 text-center text-sm text-slate-400">
                No phone call required to get started.
              </p>
              <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row">
                <a href={links.call} className="cta-secondary flex-1 justify-center">
                  Call {phoneDisplay}
                </a>
                <a href={links.text} className="cta-secondary flex-1 justify-center">
                  Text Us
                </a>
              </div>
            </div>
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
              Here&apos;s exactly how we take your project from first call to finished concrete.
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
          </div>
        </section>

        {/* ── Why choose us ── */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-8">
          <h2 className="mb-8 font-headline text-4xl text-ivory">Why Homeowners Convert Fast Here</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {["Same-day response", "Clear pricing in writing", "No-pressure estimate flow"].map((point) => (
              <div key={point} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-accent text-black">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 6.5" />
                  </svg>
                </span>
                <span className="font-semibold text-ivory">{point}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a href="/#quote" className="cta-primary text-base">
              Request My Free Estimate
            </a>
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
        <a href="/#quote" className="cta-primary flex-1 justify-center">Free Estimate</a>
        <a href={links.call} className="cta-secondary flex-1 justify-center">Call</a>
        <a href={links.text} className="cta-secondary flex-1 justify-center">Text</a>
      </div>
    </>
  );
}
