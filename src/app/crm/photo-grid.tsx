"use client";

import { useState } from "react";

// Thumbnails + tap-to-zoom lightbox. URLs point at the authenticated /api/file
// proxy, so they only load for a signed-in staff member.
export function PhotoGrid({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
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
      <div className="pg-grid">
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
          <div className="pg-stage" onClick={(e) => e.stopPropagation()}>
            {isVideo(urls[open]) ? (
              <video src={urls[open]} controls autoPlay className="pg-media" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[open]} alt="Job upload" className="pg-media" />
            )}
            {urls.length > 1 && (
              <div className="pg-nav">
                <button type="button" onClick={() => setOpen((o) => (o! - 1 + urls.length) % urls.length)}>
                  ‹ Prev
                </button>
                <span>
                  {open + 1} / {urls.length}
                </span>
                <button type="button" onClick={() => setOpen((o) => (o! + 1) % urls.length)}>
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
