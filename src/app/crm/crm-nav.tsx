"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The CRM's primary navigation.
//
// It used to be the nine links themselves, laid out in a row on the bar. That
// row never fitted: an owner has nine destinations and the widest is
// "Contractors", so even on a laptop it ran past the end of its box, and the
// fix for that was to let the strip scroll sideways. Which meant the answer to
// "where is Settings" was "swipe and find out" - a nav that hides destinations
// is doing the opposite of its job, and a bar with a moving part in the middle
// of it never looks still.
//
// So the links come off the bar entirely and live behind one button at the top
// left. The bar is then a fixed, quiet thing at every width, and every
// destination is one tap away and fully readable instead of nine of them being
// half-visible.
//
// Snappy means no machinery: no portal, no focus trap, no animation library,
// no scroll lock. A button, a list, and 90ms of opacity. It opens on the frame
// you press it.
//
// Labels and routes are untouched. This is muscle memory for two people who
// use it every day.
export type NavItem = {
  href: string;
  label: string;
  /** Sub-routes that belong to this destination - /quotes/123 is Pipeline. */
  also?: string[];
  /** Owner-only items are drawn as their own group, not as more of the same. */
  owner?: boolean;
};

// Trailing slashes make "/crm" and "/crm/" different strings and the same page.
const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

function isActive(pathname: string, base: string, item: NavItem): boolean {
  const here = norm(pathname);
  const root = norm(base) || "/";

  // The index is only itself. Matched as a prefix it would light up on every
  // page in the CRM, which is worse than no active state at all: a signal that
  // is always on says nothing.
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

  // Navigating closes it. The click that opened a link already did the work,
  // and a menu still hanging open over the page you just asked for is the
  // thing that makes a nav feel slow even when it isn't.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape, and any press outside. pointerdown rather than click so it closes
  // on the way down, at the same moment the finger lands, instead of waiting
  // for the release.
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

  // Two groups, in the order the items are already in: the ones everybody has,
  // then the owner-only ones. The rule marks a change in WHO an item is for,
  // which is the only thing about these nine links that is not obvious from
  // reading them.
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
        {/* Three bars that become a cross. Drawn with spans rather than two
            swapped icons so there is nothing to load and nothing to reflow. */}
        <span className="crm-menu-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {/* Where you are, on the button itself. The whole objection to a menu
            is that it hides the thing a row of links was telling you for free,
            so the button says it instead and the bar loses nothing. */}
        <span className="crm-menu-here">{here?.label ?? "Menu"}</span>
      </button>

      {/* Mounted only while open: nothing to paint, nothing to hit-test, and no
          hidden list sitting in the accessibility tree on every page. */}
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
                    // The styling says where you are to anyone who can see it;
                    // this is the same fact for anyone who cannot.
                    aria-current={active ? "page" : undefined}
                    // Focus the page you are on when the menu opens, so a
                    // keyboard lands where a mouse would already be looking.
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
