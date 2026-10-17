"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Primary navigation behind one menu button: nine links never fit a row, and a scrolling strip hides
// destinations. No portal, focus trap or animation library; opens on the frame you press it.
export type NavItem = {
  href: string;
  label: string;
  /** Sub-routes that belong here: /quotes/123 is Pipeline. */
  also?: string[];
  /** Drawn as their own group. */
  owner?: boolean;
};

// "/crm" and "/crm/" are the same page.
const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

function isActive(pathname: string, base: string, item: NavItem): boolean {
  const here = norm(pathname);
  const root = norm(base) || "/";

  // Exact match only, or it lights up on every page.
  if (item.href === "/") {
    if (here === root) return true;
    return (item.also ?? []).some((sub) => here.startsWith(norm(`${base}${sub}`)));
  }

  const target = norm(`${base}${item.href}`);
  return here === target || here.startsWith(`${target}/`);
}

export function CrmNav({ base, items }: { base: string; items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const here = items.find((item) => isActive(pathname, base, item));

  // Navigating closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // pointerdown so it closes as the finger lands.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Back to the button, or the next Tab starts from the top of the page.
      btnRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // The rule marks where owner-only items begin.
  const withRules = items.map((item, i) => ({
    item,
    rule: i > 0 && items[i - 1].owner !== item.owner,
  }));

  return (
    <div className="crm-menu" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={`crm-menu-btn${open ? " crm-menu-btn-on" : ""}`}
        aria-expanded={open}
        aria-controls="crm-menu-panel"
        aria-haspopup="true"
        aria-label="Menu"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Spans, not swapped icons: nothing to load or reflow. */}
        <span className="crm-menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {/* The button shows where you are, which a row of links did for free. */}
        <span className="crm-menu-here">{here?.label ?? "Menu"}</span>
      </button>

      {/* Mounted only while open: nothing in the accessibility tree otherwise. */}
      {open && (
        <nav className="crm-menu-panel" id="crm-menu-panel" aria-label="CRM sections">
          <ul className="crm-menu-list">
            {withRules.map(({ item, rule }) => {
              const active = isActive(pathname, base, item);
              return (
                <li key={item.href} className={rule ? "crm-menu-li crm-menu-rule" : "crm-menu-li"}>
                  <Link
                    href={`${base}${item.href}`}
                    className={`crm-menu-link${active ? " crm-menu-link-on" : ""}`}
                    aria-current={active ? "page" : undefined}
                    // Keyboard lands where a mouse would already be looking.
                    autoFocus={active}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
