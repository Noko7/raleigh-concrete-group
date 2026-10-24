import type { Metadata } from "next";

import { BeforeAfterSlider } from "@/components/before-after-slider";
import { GalleryGrid } from "@/components/gallery-grid";
import { MobileBar, QuoteCta, SiteFooter } from "@/components/site-chrome";
import { SiteHeader } from "@/components/site-header";
import {
  galleryImages,
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
      <main>
        <section className="mx-auto w-full max-w-6xl px-4 pb-8 pt-12 md:px-8 md:pt-16">
          <h1 className="font-headline text-5xl text-ivory md:text-6xl">Recent Work</h1>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <GalleryGrid images={galleryImages} />
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-14 md:px-8">
          <h2 className="mb-6 font-headline text-4xl text-ivory">See the Before &amp; After</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {sharedBeforeAfter.map((pair) => (
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

        <QuoteCta heading="Like What You See?" />

        <SiteFooter />
      </main>

      <MobileBar />
    </>
  );
}
