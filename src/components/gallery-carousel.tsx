"use client";

import Image from "next/image";
import { useState } from "react";

import { Lightbox } from "@/components/lightbox";

type GalleryImage = { src: string; alt: string };

type GalleryCarouselProps = {
  images: GalleryImage[];
};

// Continuous, smooth auto-scrolling strip of recent work. The list is rendered
// twice and the track animates to -50% so the loop is seamless. Clicking any
// tile opens an expandable lightbox.
export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      <div className="gscroll" role="region" aria-label="Recent work gallery">
        <div className="gscroll-track">
          {[...images, ...images].map((img, i) => {
            const realIndex = i % images.length;
            return (
              <button
                type="button"
                key={`${img.src}-${i}`}
                className="gscroll-item"
                aria-hidden={i >= images.length}
                aria-label={`Expand: ${img.alt}`}
                tabIndex={i >= images.length ? -1 : 0}
                onClick={() => setActive(realIndex)}
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={520}
                  height={340}
                  sizes="(max-width: 768px) 70vw, 26rem"
                  className="gscroll-img"
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
