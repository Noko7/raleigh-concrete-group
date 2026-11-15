import type { Metadata } from "next";
import Image from "next/image";

import { MobileBar, QuoteCta, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import { stampStyleSections } from "@/lib/stamp-styles";

export const metadata: Metadata = {
  title: "Stamped Concrete Styles | Patterns & Textures",
  description:
    "Browse stamped concrete patterns and textures: slate, stone, cobble, brick, wood plank, seamless textures, borders and medallions. Pick the style you like and mention it in your free quote.",
  alternates: { canonical: "/styles" },
};

export default function StylesPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 md:px-8 md:pt-16">
          <h1 className="mb-4 font-headline text-5xl text-ivory md:text-6xl">Stamped Concrete Styles</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-slate-300">
            Browse the stamp patterns and textures from our supplier. Find one you like and tell us its name
            when you ask for your quote.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Colors in the photos are just examples. Every style can be done in the color you choose.
          </p>

          <nav aria-label="Style categories" className="mt-7 flex flex-wrap gap-2">
            {stampStyleSections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-accent/60 hover:text-amber-accent"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </section>

        {stampStyleSections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pb-14 md:px-8"
          >
            <div className="mb-5 border-b border-white/10 pb-3">
              <h2 id={`${section.id}-heading`} className="font-headline text-4xl text-ivory">
                {section.title}
              </h2>
              <p className="mt-1 text-sm text-slate-400">{section.blurb}</p>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {section.styles.map((style) => (
                <li key={style.src}>
                  <figure>
                    <div className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5">
                      <Image
                        src={style.src}
                        alt={`${style.name} stamped concrete`}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 270px"
                        className="object-cover"
                      />
                    </div>
                    <figcaption className="mt-2 text-sm font-semibold leading-snug text-ivory">
                      {style.name}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-slate-500 md:px-8">
          Pattern photos from the Sika decorative concrete product guide.
        </p>

        <QuoteCta heading="Found Your Style?" />

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
