"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Lightbox } from "@/components/lightbox";

type GalleryImage = { src: string; alt: string };

type GalleryCarouselProps = {
  images: GalleryImage[];
};

// About 36px/s on desktop, 24 on a phone.
const SECONDS_PER_PHOTO = 12;
const RESUME_AFTER_MS = 2500;
// A shorter mouse drag is still a click.
const DRAG_THRESHOLD_PX = 6;

// Auto-scrolls but can be swiped, scrolled or dragged. Rendered twice and wrapped by half its width to loop
// seamlessly both ways.
export function GalleryCarousel({ images }: GalleryCarouselProps) {
  const [active, setActive] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pausedUntil = useRef(0);
  const hovering = useRef(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const half = () => el.scrollWidth / 2;
    // Start in the middle so there is room to scroll both ways.
    el.scrollLeft = half();

    let raf = 0;
    let last = performance.now();
    let pos = el.scrollLeft;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const h = half();
      if (h > 0) {
        // Wrap by half (the copies are identical), carrying any in-progress drag.
        const shift = el.scrollLeft < 1 ? h : el.scrollLeft >= h * 2 - el.clientWidth - 1 ? -h : 0;
        if (shift) {
          el.scrollLeft += shift;
          if (drag.current) drag.current.left += shift;
        }
        const idle = !reduced && !hovering.current && !drag.current && now >= pausedUntil.current;
        if (idle) {
          // Fractional position kept here: scrollLeft rounds to whole pixels, so a slow drift would never move.
          if (Math.abs(pos - el.scrollLeft) > 2) pos = el.scrollLeft;
          pos -= (h / (images.length * SECONDS_PER_PHOTO * 1000)) * dt;
          el.scrollLeft = pos;
        } else {
          pos = el.scrollLeft;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [images.length]);

  const holdOff = () => {
    pausedUntil.current = performance.now() + RESUME_AFTER_MS;
  };

  return (
    <>
      <div
        ref={ref}
        className="gscroll"
        role="region"
        aria-label="Recent work gallery"
        onWheel={holdOff}
        onTouchStart={holdOff}
        onTouchMove={holdOff}
        onTouchEnd={holdOff}
        onMouseEnter={() => (hovering.current = true)}
        onMouseLeave={() => {
          hovering.current = false;
          drag.current = null;
          holdOff();
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > DRAG_THRESHOLD_PX) d.moved = true;
          if (d.moved) ref.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => {
          suppressClick.current = Boolean(drag.current?.moved);
          drag.current = null;
          holdOff();
        }}
      >
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
                onFocus={holdOff}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  setActive(realIndex);
                }}
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={520}
                  height={340}
                  sizes="(max-width: 768px) 70vw, 26rem"
                  className="gscroll-img"
                  draggable={false}
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
