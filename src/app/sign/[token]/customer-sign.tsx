"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DocusealForm } from "@docuseal/react";

// DocuSeal's signing form, embedded. When it's done, the page reloads to the "Signed" state once the webhook has
// recorded it.
export function CustomerSign({ src }: { src: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  return (
    <div className="sg-form">
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
