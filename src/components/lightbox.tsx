"use client";

import Image from "next/image";
import { useCallback, useEffect } from "react";

export type LightboxImage = { src: string; alt: string };

type LightboxProps = {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
};

export function Lightbox({ images, index, onClose, onNavigate }: LightboxProps) {
  const open = index !== null;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = (index + delta + images.length) % images.length;
      onNavigate(next);
    },
    [index, images.length, onNavigate],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, go, onClose]);

  if (index === null) return null;
  const current = images[index];
  if (!current) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
      onClick={onClose}
    >
      <button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}>
        &times;
      </button>

      {images.length > 1 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-l"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
        >
          &#8249;
        </button>
      )}

      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <Image
          src={current.src}
          alt={current.alt}
          width={1600}
          height={1067}
          sizes="100vw"
          className="lightbox-img"
          quality={90}
          priority
        />
        <p className="lightbox-caption">{current.alt}</p>
      </div>

      {images.length > 1 && (
        <button
          type="button"
          className="lightbox-nav lightbox-nav-r"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
        >
          &#8250;
        </button>
      )}
    </div>
  );
}
