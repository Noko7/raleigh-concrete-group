"use client";

export function PrintButton() {
  return (
    <button type="button" className="cq-btn rc-print" onClick={() => window.print()}>
      Print
    </button>
  );
}
