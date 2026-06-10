"use client";

import { useState } from "react";

// Thumbnails + tap-to-zoom lightbox. URLs point at the authenticated /api/file
// proxy, so they only load for a signed-in staff member.
export function PhotoGrid({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const isVideo = (u: string) => /\.(mp4|mov|webm|quicktime)(\?|$)/i.test(u);

  return (
    <>
      <div className="pg-grid">
        {urls.map((u, i) => (
          <button key={u} type="button" className="pg-thumb" onClick={() => setOpen(i)} aria-label={`Open file ${i + 1}`}>
            {isVideo(u) ? (
              <span className="pg-video-tag">Video</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u} alt={`Job upload ${i + 1}`} loading="lazy" />
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
