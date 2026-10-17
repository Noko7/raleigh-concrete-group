"use client";

// Icons inherit currentColor.
export const svgBase = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
export function IconBolt() {
  return (
    <svg {...svgBase}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}
export function IconCalendar() {
  return (
    <svg {...svgBase}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}
export function IconCamera() {
  return (
    <svg {...svgBase}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}
export function IconCheck({ className }: { className?: string }) {
  return (
    <svg {...svgBase} className={className}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}
export function IconArrow() {
  return (
    <svg {...svgBase} className="qm-choice-arrow">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function IconBack() {
  return (
    <svg {...svgBase}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}
export function IconClose() {
  return (
    <svg {...svgBase}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}
