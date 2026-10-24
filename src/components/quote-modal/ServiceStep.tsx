"use client";

import type { Dispatch, SetStateAction } from "react";
import { quoteServiceOptions } from "@/lib/site-data";
import { IconCamera, IconCheck, IconClose } from "./icons";
import { StepHead, type FormState, type Mode } from "./shared";

export function ServiceStep({
  mode,
  data,
  set,
  files,
  setFiles,
  addFiles,
  fileError,
  hasDetails,
  errorMsg,
}: {
  mode: Mode | null;
  data: FormState;
  set: (patch: Partial<FormState>) => void;
  files: File[];
  setFiles: Dispatch<SetStateAction<File[]>>;
  addFiles: (list: FileList | null) => void;
  fileError: string;
  hasDetails: boolean;
  errorMsg: string;
}) {
  return (
    <div className="qm-body">
      <StepHead title="What are we pouring?" />
      {/* Tiles, not a <select>: every choice visible, one tap. */}
      <div className="qm-tiles" role="radiogroup" aria-label="What do you need?">
        {quoteServiceOptions.map((option) => {
          const on = data.service === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              className={`qm-tile${on ? " qm-tile--on" : ""}`}
              onClick={() => set({ service: option })}
            >
              {option.replace("/", " / ")}
              {on && <IconCheck className="qm-tile-check" />}
            </button>
          );
        })}
      </div>

      <label className={`qm-dropzone qm-mt${mode === "online" ? " qm-dropzone--main" : ""}`}>
        <input data-clarity-mask="true"
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          hidden
        />
        <span className="qm-dropzone-icon">
          <IconCamera />
        </span>
        <span className="qm-dropzone-title">
          {files.length ? "Add more photos" : "Add a photo of the spot"}
        </span>
        <span className="qm-dropzone-hint">
          {mode === "online" ? "Required · up to 8 photos or videos" : "Optional · up to 8 photos or videos"}
        </span>
      </label>
      {fileError && <p className="qm-err">{fileError}</p>}
      {files.length > 0 && (
        <ul className="qm-filelist" data-clarity-mask="true">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="qm-file-name">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${f.name}`}
              >
                <IconClose />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="qm-label qm-mt" htmlFor="qm-details">
        {mode === "online" ? (
          "Describe the job"
        ) : (
          <>
            Anything else? <span className="qm-optional">optional</span>
          </>
        )}
      </label>
      <textarea data-clarity-mask="true"
        id="qm-details"
        className="qm-input"
        rows={2}
        value={data.details}
        onChange={(e) => set({ details: e.target.value })}
        placeholder={
          mode === "online"
            ? "What needs doing, rough size (like 20x30 ft), and when you want it done"
            : "Rough size (like 20x30 ft) or when you want it done"
        }
      />
      {mode === "online" && !hasDetails && data.details.trim().length > 0 && (
        <p className="qm-dropzone-hint">A few more words, please.</p>
      )}
      {errorMsg && <p className="qm-err">{errorMsg}</p>}
    </div>
  );
}
