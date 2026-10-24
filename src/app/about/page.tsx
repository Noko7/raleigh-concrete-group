import type { Metadata } from "next";
import Image from "next/image";

import { CtaButtons, MobileBar, QuoteCta, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import {
  businessName,
  clipboardImage,
  trustImage,
} from "@/lib/site-data";

export const metadata: Metadata = {
  title: "About Raleigh Concrete Group | Local Concrete Contractor",
  description:
    "Raleigh Concrete Group is a locally run concrete contractor serving Raleigh and the Triangle since 2020, with 20+ years of combined crew experience, honest pricing and clean job sites.",
  alternates: { canonical: "/about" },
};

const promises = [
  "We answer the phone and keep you in the loop",
  "We show up when we say we will",
  "Our estimates are clear and free",
  "We take pride in the finish work",
  "We leave the job site clean",
  "We build it to last",
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden py-12 md:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_30%,rgba(194,104,42,0.18),transparent_48%)]" />
          <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 md:px-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="mb-5 font-headline text-5xl leading-[0.95] text-ivory md:text-6xl">
                About {businessName}
              </h1>
              <p className="mb-4 max-w-lg text-lg leading-relaxed text-slate-300">
                We&apos;re a locally run concrete contractor working with homeowners and businesses
                across Raleigh and the surrounding Triangle. We started the company in 2020 with a
                pretty simple idea: do dependable concrete work, communicate like professionals,
                price things honestly, and build stuff that lasts.
              </p>
              <CtaButtons />
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <Image
                src={trustImage}
                alt="Raleigh Concrete Group walking a homeowner through their quote"
                width={1000}
                height={750}
                className="h-full w-full object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                quality={90}
                priority
              />
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-3xl px-4 pb-12 md:px-8">
          <div className="space-y-5 text-lg leading-relaxed text-slate-300">
            <p>
              We&apos;ve been pouring concrete around the Triangle since 2020, and the people doing
              the work bring more than 20 years of combined hands-on concrete experience, on
              everything from residential driveways and patios to commercial flatwork. Whether
              it&apos;s stamped concrete, sidewalks, slabs or a full driveway, our team knows how to
              build surfaces that hold up to North Carolina weather and everyday use.
            </p>
            <p>
              We care about the things that actually show up in the finished product: solid site
              prep, clean finishes, durable materials, and proven installation methods. And we manage
              the whole project from start to finish, so you&apos;re never left guessing about what
              happens next.
            </p>
            <p>
              Our goal is simple. We want to become one of the most trusted concrete contractors in
              the Raleigh area by doing good work and treating every project like it matters, because
              it does.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <div className="grid gap-8 rounded-3xl border border-white/10 bg-white/5 p-6 md:grid-cols-2 md:p-10">
            <div>
              <h2 className="mb-5 font-headline text-3xl text-ivory">Why Homeowners Choose Us</h2>
              <ul className="space-y-3">
                {promises.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-slate-200">
                    <span className="mt-1 text-amber-accent">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <Image
                src={clipboardImage}
                alt="Raleigh Concrete Group contractor preparing a written estimate"
                width={1000}
                height={750}
                className="h-full w-full object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
                quality={90}
              />
            </div>
          </div>
        </section>

        <QuoteCta heading="Let's Talk About Your Project" />

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
