"use client";

import Image from "next/image";
import { useState } from "react";

import { Lightbox } from "@/components/lightbox";

type GalleryImage = { src: string; alt: string };

export function GalleryGrid({ images }: { images: GalleryImage[] }) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <>
      <div className="gallery-grid">
        {images.map((img, i) => (
          <button
            type="button"
            key={img.src}
            className="gallery-tile"
            aria-label={`Expand: ${img.alt}`}
            onClick={() => setActive(i)}
          >
            <Image
              src={img.src}
              alt={img.alt}
              width={640}
              height={480}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="gallery-tile-img"
              priority={i < 4}
            />
          </button>
        ))}
      </div>

      <Lightbox images={images} index={active} onClose={() => setActive(null)} onNavigate={setActive} />
    </>
  );
}
