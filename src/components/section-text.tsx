"use client";

import { useState } from "react";

// Past this, a section is folded to its first few lines with a "Show more".
// One owner writes "Not applicable" under Permits and a paragraph under Pour
// and finish; on a phone the paragraph pushes the Approve button a screen
// further down. Folded, every section takes about the same room until the
// customer asks for the rest. The full text is in the page either way, only
// clipped, so nothing is hidden from search-in-page or a screen reader.
const FOLD_CHARS = 240;
const FOLD_LINES = 5;

export function SectionText({ text }: { text: string }) {
  const long = text.length > FOLD_CHARS || text.split("\n").length > FOLD_LINES;
  const [open, setOpen] = useState(false);
  if (!long) return <p className="cq-step-text">{text}</p>;
  return (
    <>
      <p className={`cq-step-text${open ? "" : " cq-step-text-folded"}`}>{text}</p>
      <button type="button" className="cq-step-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Show less" : "Show more"}
      </button>
    </>
  );
}
