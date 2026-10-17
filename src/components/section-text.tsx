"use client";

import { useState } from "react";

// Long text folds to a few lines with "Show more" so a long section doesn't push Approve off screen.
// The full text stays in the DOM (search-in-page, screen readers). Option descriptions fold sooner.
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
          // Inside a tappable card: reading more isn't picking it.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {open ? less : more}
      </button>
    </>
  );
}
