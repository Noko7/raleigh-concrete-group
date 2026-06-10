"use client";

import Image from "next/image";
import { useRef, useState, useCallback, useEffect } from "react";

type BeforeAfterSliderProps = {
  beforeSrc: string;
  afterSrc: string;
  beforeAlt: string;
  afterAlt: string;
};

export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
}: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.min(Math.max(((clientX - rect.left) / rect.width) * 100, 2), 98);
    setPosition(pct);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    updatePosition(e.clientX);
  };
  const onPointerUp = () => { dragging.current = false; };

  // Touch on container
  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    updatePosition(e.touches[0].clientX);
  }, [updatePosition]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [onTouchMove]);

  return (
    <div
      ref={containerRef}
      className="ba-slider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      role="img"
      aria-label="Before and after comparison"
    >
      {/* After (base layer, full width) */}
      <div className="ba-layer ba-after">
        <Image
          src={afterSrc}
          alt={afterAlt}
          fill
          sizes="(max-width:768px) 100vw, 800px"
          className="ba-img"
        />
        <span className="ba-label ba-label-right">After</span>
      </div>

      {/* Before (clipped to left of handle) */}
      <div className="ba-layer ba-before" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <Image
          src={beforeSrc}
          alt={beforeAlt}
          fill
          sizes="(max-width:768px) 100vw, 800px"
          className="ba-img"
        />
        <span className="ba-label ba-label-left">Before</span>
      </div>

      {/* Divider + handle */}
      <div className="ba-divider" style={{ left: `${position}%` }}>
        <div
          className="ba-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 7l-5 5 5 5V7zm8 0v10l5-5-5-5z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
