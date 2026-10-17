"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addJobPhotos, type PhotoKind } from "./quotes/[id]/photo-actions";

// Staff photo uploads (internal shots, and the before/after pair needed to close a job).
// Straight to Storage via a one-time signed URL from /api/upload-url (object named server-side); only
// paths reach the server action, keeping files out of its small body limit.
const ACCEPT = "image/*,video/*";
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_AT_ONCE = 8;

// Browsers often report an empty type for .heic.
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
};

function describe(file: File): { ext: string; contentType: string } | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const contentType = file.type || EXT_MIME[ext] || "";
  if (!ext || !contentType) return null;
  return { ext, contentType };
}

export function PhotoUpload({
  quoteId,
  kind,
  label,
  light = false,
}: {
  quoteId: string;
  kind: PhotoKind;
  label: string;
  // Job page is a light card; the CRM is dark.
  light?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setError("");

    if (picked.length > MAX_AT_ONCE) {
      setError(`Up to ${MAX_AT_ONCE} files at a time.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    const paths: string[] = [];
    try {
      for (const file of picked) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is over 50MB.`);
          continue;
        }
        const described = describe(file);
        if (!described) {
          setError(`${file.name} isn't a photo or video.`);
          continue;
        }

        const signRes = await fetch("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(described),
        });
        const signed = (await signRes.json().catch(() => ({}))) as {
          ok?: boolean;
          path?: string;
          uploadUrl?: string;
          error?: string;
        };
        if (!signRes.ok || !signed.ok || !signed.uploadUrl || !signed.path) {
          setError(signed.error || "Could not start the upload.");
          continue;
        }

        const put = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": described.contentType, "x-upsert": "true" },
          body: file,
        });
        if (!put.ok) {
          setError(`${file.name} failed to upload.`);
          continue;
        }
        paths.push(signed.path);
      }
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }

    if (paths.length === 0) return;

    // Recorded only once the bytes are in the bucket, so no path points at nothing.
    startTransition(async () => {
      const res = await addJobPhotos(quoteId, kind, paths);
      if (!res.ok) setError(res.error ?? "Could not save those photos.");
      else router.refresh();
    });
  }

  const working = busy || pending;

  return (
    <div className={light ? "pu pu-light" : "pu"}>
      <label className="pu-btn">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={onPick}
          disabled={working}
          hidden
        />
        {working ? "Uploading…" : label}
      </label>
      {error && <span className="pu-err">{error}</span>}
    </div>
  );
}
