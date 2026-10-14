"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Lightbox } from "@/components/lightbox";

type GalleryImage = { src: string; alt: string };

type GalleryCarouselProps = {
  images: GalleryImage[];
};

// How long each photo takes to pass: about 36px a second on desktop and 24 on
// a phone, slow enough to look at a photo as it goes by.
const SECONDS_PER_PHOTO = 12;
// After a swipe, drag or scroll, how long the strip waits before drifting again.
const RESUME_AFTER_MS = 2500;
// A mouse drag shorter than this is still a click on the photo.
const DRAG_THRESHOLD_PX = 6;

// Auto-scrolling strip of recent work that customers can also scroll freely:
// swipe on a phone, trackpad or drag with a mouse. The list is rendered twice
// and the scroll position wraps by half its width, so it loops seamlessly in
// either direction. Clicking a tile opens the lightbox.
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
        // Wrap by half the width - the two copies look identical - and carry an
        // in-progress mouse drag across with it.
        const shift = el.scrollLeft < 1 ? h : el.scrollLeft >= h * 2 - el.clientWidth - 1 ? -h : 0;
        if (shift) {
          el.scrollLeft += shift;
          if (drag.current) drag.current.left += shift;
        }
        const idle = !reduced && !hovering.current && !drag.current && now >= pausedUntil.current;
        if (idle) {
          // Fractional position kept here: scrollLeft rounds to whole pixels,
          // and a slow drift would otherwise never move.
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
