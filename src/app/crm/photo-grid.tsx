"use client";

import { useEffect, useRef, useState } from "react";

// Thumbnails + tap-to-zoom lightbox. URLs point at the authenticated /api/file
// proxy, so they only load for a signed-in staff member. `light` for the crew's
// white job card; the CRM's dark pages use the default.
export function PhotoGrid({ urls, light = false }: { urls: string[]; light?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = urls.length;
  const step = (by: 1 | -1) => setOpen((o) => (o === null ? o : (o + by + count) % count));

  // Escape closes, arrow keys page through - for whoever opens these at a desk.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight" && count > 1) step(1);
      else if (e.key === "ArrowLeft" && count > 1) step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, count]);

  // Swipe between photos on a phone, which is where these are mostly looked
  // at: a sideways drag of more than 50px moves one photo that way.
  const touchX = useRef<number | null>(null);
  // The extension is inside the proxy URL's `p` parameter, so it is followed by
  // `&` as often as by the end of the string - the signature and expiry are
  // appended after it. Matching only `?|$` meant every video started rendering
  // as a broken <img> the moment those parameters arrived.
  const isVideo = (u: string) => /\.(mp4|mov|webm|quicktime)(\?|&|$)/i.test(u);

  // The grid asks the proxy for a thumbnail; the lightbox asks for the file.
  // 640 rather than the 150 it is drawn at, so a retina screen still gets a
  // sharp square and a tap-to-zoom on the way to the lightbox has something to
  // show while the original loads.
  const thumb = (u: string) => (u.includes("?") ? `${u}&w=640` : `${u}?w=640`);

  return (
    <>
      <div className={light ? "pg-grid pg-light" : "pg-grid"}>
        {urls.map((u, i) => (
          <button key={u} type="button" className="pg-thumb" onClick={() => setOpen(i)} aria-label={`Open file ${i + 1}`}>
            {isVideo(u) ? (
              <span className="pg-video-tag">Video</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb(u)}
                alt={`Job upload ${i + 1}`}
                loading="lazy"
                // Hands the decode to the browser to schedule off the main
                // thread. With a full-size original this was the jank; with a
                // thumbnail it is cheap either way, and free to ask for.
                decoding="async"
                width={640}
                height={640}
              />
            )}
          </button>
        ))}
      </div>

      {open !== null && (
        <div className="pg-lightbox" onClick={() => setOpen(null)} role="dialog" aria-modal="true">
          <button className="pg-close" aria-label="Close">
            ✕
          </button>
          <div
            className="pg-stage"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
            onTouchEnd={(e) => {
              const start = touchX.current;
              touchX.current = null;
              const end = e.changedTouches[0]?.clientX;
              if (start == null || end == null || count < 2) return;
              if (end - start > 50) step(-1);
              else if (start - end > 50) step(1);
            }}
          >
            {isVideo(urls[open]) ? (
              <video src={urls[open]} controls autoPlay className="pg-media" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[open]} alt="Job upload" className="pg-media" />
            )}
            {urls.length > 1 && (
              <div className="pg-nav">
                <button type="button" onClick={() => step(-1)}>
                  ‹ Prev
                </button>
                <span>
                  {open + 1} / {urls.length}
                </span>
                <button type="button" onClick={() => step(1)}>
                  Next ›
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
