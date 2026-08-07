"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createAgreement } from "./actions";
import type { AgreementState } from "./types";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.webp";
const MAX_BYTES = 25 * 1024 * 1024;

// Maps a picked file to the extension + MIME the upload route expects. Browsers
// sometimes report an empty type for .heic, so fall back to the extension.
function describe(file: File): { ext: string; contentType: string } | null {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    heic: "image/heic",
    webp: "image/webp",
  };
  const contentType = byExt[ext] ?? file.type;
  if (!ext || !contentType) return null;
  return { ext, contentType };
}

export function AddAgreement({
  kind,
  targetId,
  defaultTitle,
}: {
  kind: "contractor" | "customer";
  targetId: string;
  defaultTitle: string;
}) {
  const [state, formAction, pending] = useActionState<AgreementState, FormData>(createAgreement, { ok: false });
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Collapse the form once the save lands — the saved row shows up in the list
  // above via revalidatePath, so leaving a filled-in form open is just confusing.
  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setFilePath("");
      setFileName("");
    }
  }, [state.ok]);

  // Upload straight to Supabase Storage with a one-time signed URL, then keep
  // just the returned path to submit with the form. Keeps the contract out of
  // the server-action body, which has a much smaller size limit.
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setFilePath("");
    setFileName("");

    if (file.size > MAX_BYTES) {
      setUploadError("That file is over 25MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const described = describe(file);
    if (!described) {
      setUploadError("Upload a PDF or an image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const signRes = await fetch("/crm/api/agreement-upload", {
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
        setUploadError(signed.error || "Could not start the upload.");
        return;
      }

      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": described.contentType },
        body: file,
      });
      if (!put.ok) {
        setUploadError("The upload failed. Try again.");
        return;
      }
      setFilePath(signed.path);
      setFileName(file.name);
    } catch {
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(true)}>
        Add agreement
      </button>
    );
  }

  return (
    <form action={formAction} className="crm-editor ag-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name={kind === "contractor" ? "staff_id" : "quote_id"} value={targetId} />
      <input type="hidden" name="file_path" value={filePath} />

      <div className="crm-editor-row">
        <label className="crm-field">
          <span>Title</span>
          <input name="title" className="crm-input" defaultValue={defaultTitle} required />
        </label>
        <label className="crm-field">
          <span>Status</span>
          <select name="status" className="crm-input" defaultValue="sent">
            <option value="pending">Not sent yet</option>
            <option value="sent">Sent for signature</option>
            <option value="signed">Signed</option>
            <option value="declined">Declined</option>
            <option value="void">Void</option>
          </select>
        </label>
      </div>

      <label className="crm-field">
        <span>DocuSeal link (optional)</span>
        <input
          name="docuseal_url"
          type="url"
          className="crm-input"
          placeholder="https://docuseal.com/s/…"
        />
      </label>

      <label className="crm-field">
        <span>Contract file (optional)</span>
        <input ref={inputRef} type="file" accept={ACCEPT} className="crm-input" onChange={onPick} />
      </label>
      {uploading && <p className="crm-muted crm-sm">Uploading…</p>}
      {fileName && !uploading && <p className="crm-muted crm-sm">Attached: {fileName}</p>}
      {uploadError && <p className="crm-auth-error">{uploadError}</p>}

      <label className="crm-field">
        <span>Notes (optional)</span>
        <textarea name="notes" className="crm-input" rows={2} />
      </label>

      <div className="crm-editor-foot">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={pending || uploading}>
          {pending ? "Saving…" : "Save agreement"}
        </button>
        <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        {state.error && <span className="crm-auth-error">{state.error}</span>}
      </div>
      <p className="crm-muted crm-sm">
        Send the document from DocuSeal, then record it here. Paste the DocuSeal link so you can jump back to it, and
        attach the signed PDF once it comes back.
      </p>
    </form>
  );
}
