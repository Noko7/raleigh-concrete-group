"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DocusealForm } from "@docuseal/react";

// DocuSeal's signing form, embedded, plus a way to open the same signing page full screen in its own tab (easier to
// read on a phone than the embed with DocuSeal's prompts). Either way, when it's done the page reloads to the
// "Signed" state once the webhook has recorded it; coming back from the other tab reloads it too.
export function CustomerSign({ src }: { src: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  // Only a real https link is offered as a button (it comes from DocuSeal, but never trust a stored URL blindly).
  const fullScreen = /^https:\/\//i.test(src) ? src : null;

  useEffect(() => {
    // Back from the full-screen tab: show whatever happened there (signed, or still waiting).
    const back = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [router]);

  return (
    <div className="sg-form">
      {fullScreen && (
        <a className="cq-btn cq-btn-primary sg-full" href={fullScreen} target="_blank" rel="noopener noreferrer">
          Open full screen to read and sign
        </a>
      )}
      <DocusealForm
        src={src}
        withTitle={false}
        withDownloadButton
        onComplete={() => {
          setDone(true);
          setTimeout(() => router.refresh(), 3000);
        }}
      />
      {done && <p className="sg-small">Thank you. Finishing up…</p>}
    </div>
  );
}
