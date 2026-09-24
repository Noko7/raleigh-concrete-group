"use client";

import { useState } from "react";

// Past a length, text is folded to its first few lines with a "Show more".
// One owner writes "Not applicable" under Permits and a paragraph under Pour
// and finish; on a phone the paragraph pushes the Approve button a screen
// further down. Folded, every block takes about the same room until the
// customer asks for the rest. The full text is in the page either way, only
// clipped, so nothing is hidden from search-in-page or a screen reader.
//
// Used for the quote's sections and for the descriptions on its options, which
// fold sooner: there the price and the choice are the point, the paragraph
// under them is for whoever wants it.
export function SectionText({
  text,
  chars = 240,
  lines = 4,
  more = "Show more",
  less = "Show less",
  className = "cq-step-text",
}: {
  text: string;
  chars?: number;
  lines?: number;
  more?: string;
  less?: string;
  className?: string;
}) {
  const long = text.length > chars || text.split("\n").length > lines + 1;
  const [open, setOpen] = useState(false);
  if (!long) return <p className={className}>{text}</p>;
  return (
    <>
      <p
        className={`${className}${open ? "" : " cq-folded"}`}
        style={open ? undefined : ({ WebkitLineClamp: lines, lineClamp: lines } as React.CSSProperties)}
      >
        {text}
      </p>
      <button
        type="button"
        className="cq-step-more"
        aria-expanded={open}
        onClick={(e) => {
          // Inside a card that is itself a control (an option they tap to
          // pick): reading more is not picking it.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {open ? less : more}
      </button>
    </>
  );
}
