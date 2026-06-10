"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type GalleryImage = { src: string; alt: string };

type GalleryCarouselProps = {
  images: GalleryImage[];
};

export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (index: number) => {
    setActive((index + images.length) % images.length);
  };

  const reset = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setActive((a) => (a + 1) % images.length), 4000);
  };

  useEffect(() => {
    reset();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, images.length]);

  const prev = () => { go(active - 1); };
  const next = () => { go(active + 1); };

  return (
    <div className="gallery-wrap">
      <div className="gallery-stage">
        {images.map((img, i) => (
          <div
            key={img.src}
            className={`gallery-slide${i === active ? " gallery-slide--active" : ""}`}
            aria-hidden={i !== active}
          >
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes="(max-width:768px) 100vw, 1200px"
              className="gallery-img"
              priority={i === 0}
            />
          </div>
        ))}

        <button onClick={prev} className="gallery-arrow gallery-arrow-l" aria-label="Previous photo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <button onClick={next} className="gallery-arrow gallery-arrow-r" aria-label="Next photo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
      </div>

      <div className="gallery-dots">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={`gallery-dot${i === active ? " gallery-dot--active" : ""}`}
            aria-label={`Go to photo ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
