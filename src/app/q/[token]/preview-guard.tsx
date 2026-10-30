"use client";

import { useEffect } from "react";

// The office's preview of this page (?preview=1, framed on the job page): it looks exactly as the customer
// sees it, but nothing on it acts. A tap on Approve, Decline or Pay would otherwise do it for real.
// Inputs and fold-outs still work, so the page can be read and scrolled as the customer would.
export function PreviewGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.('a, button, [role="button"], input[type="submit"]');
      if (!el || el.closest("summary")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}
