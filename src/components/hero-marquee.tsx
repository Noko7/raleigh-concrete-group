"use client";

import Image from "next/image";
import { useState } from "react";

import { Lightbox } from "@/components/lightbox";

type MarqueeImage = { src: string; alt: string };

// Continuous auto-scrolling hero strip. The list is rendered twice so the loop
// is seamless; clicking any tile opens the full-resolution lightbox.
export function HeroMarquee({ images }: { images: MarqueeImage[] }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      <div className="marquee">
        <div className="marquee-track">
          {[...images, ...images].map((img, i) => {
            const realIndex = i % images.length;
            const clone = i >= images.length;
            return (
              <button
                type="button"
                key={`${img.src}-${i}`}
                className="marquee-item"
                aria-hidden={clone}
                tabIndex={clone ? -1 : 0}
                aria-label={`Expand: ${img.alt}`}
                onClick={() => setActive(realIndex)}
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={384}
                  height={256}
                  sizes="(max-width: 768px) 60vw, 20rem"
                  className="marquee-img"
                  priority={i < 4}
                />
              </button>
            );
          })}
        </div>
      </div>

      <Lightbox images={images} index={active} onClose={() => setActive(null)} onNavigate={setActive} />
    </>
  );
}
