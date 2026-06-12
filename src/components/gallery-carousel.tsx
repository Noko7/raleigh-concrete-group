"use client";

import Image from "next/image";

type GalleryImage = { src: string; alt: string };

type GalleryCarouselProps = {
  images: GalleryImage[];
};

// Continuous, smooth auto-scrolling strip of recent work. The list is rendered
// twice and the track animates to -50% so the loop is seamless. Scrolls the
// opposite direction from the hero strip and pauses on hover.
export function GalleryCarousel({ images }: GalleryCarouselProps) {
  return (
    <div className="gscroll" role="region" aria-label="Recent work gallery">
      <div className="gscroll-track">
        {[...images, ...images].map((img, i) => (
          <div key={`${img.src}-${i}`} className="gscroll-item" aria-hidden={i >= images.length}>
            <Image
              src={img.src}
              alt={img.alt}
              width={520}
              height={340}
              sizes="(max-width: 768px) 70vw, 26rem"
              className="gscroll-img"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
