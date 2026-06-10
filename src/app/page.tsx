import Image from "next/image";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { businessName, links, locationKeys, locations, phoneDisplay } from "@/lib/site-data";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pb-6 pt-12 md:pt-16">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_30%,rgba(194,104,42,0.18),transparent_45%)]" />
          <div className="relative mx-auto max-w-6xl px-4 text-center md:px-8">
            <span className="mb-4 inline-block text-xs font-bold uppercase tracking-[0.22em] text-amber-accent">
              Raleigh · Cary · Apex · Wake Forest · Durham · More Coming Soon
            </span>
            <h1 className="mx-auto mb-5 max-w-4xl font-headline text-6xl leading-[0.92] text-ivory md:text-8xl">
              Concrete &amp; Hardscape. Built to Last.
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-slate-300">
              Driveways, patios, walkways, retaining walls and pavers — done right the first time by a
              crew that actually shows up. Serving Raleigh and the Triangle.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/raleigh#quote" className="cta-primary text-base">
                Get Free Quote
              </Link>
              <a href={links.call} className="cta-secondary text-base">
                Call {phoneDisplay}
              </a>
            </div>
          </div>
        </section>

        {/* Location picker */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 md:px-8">
          <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
            Select Your Location
          </span>
          <h2 className="mb-8 font-headline text-4xl text-ivory">Your City, Your Crew</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {locationKeys.map((key) => {
              const loc = locations[key];
              return (
                <Link
                  key={key}
                  href={`/${key}`}
                  className="group overflow-hidden rounded-3xl border border-white/10 bg-white/5 transition hover:-translate-y-1 hover:border-amber-accent/50 hover:bg-white/10"
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden">
                    <Image
                      src={loc.heroImage}
                      alt={`${loc.city} concrete and hardscaping`}
                      fill
                      sizes="(max-width:768px) 100vw, 33vw"
                      className="object-cover transition duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-5">
                    <span className="text-xs font-bold uppercase tracking-[0.18em] text-amber-accent">
                      North Carolina
                    </span>
                    <h3 className="mt-1 font-headline text-4xl text-ivory">{loc.city}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">{loc.description}</p>
                    <span className="mt-4 inline-block text-sm font-bold uppercase tracking-[0.12em] text-ivory opacity-60 transition group-hover:opacity-100">
                      View {loc.city} Page →
                    </span>
                  </div>
                </Link>
              );
            })}
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
    </>
  );
}
