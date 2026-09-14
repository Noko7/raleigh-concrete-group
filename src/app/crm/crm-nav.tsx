"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// The CRM's primary navigation.
//
// It was nine identical links in a row with a hover colour, and the one thing
// a nav has to do beyond linking - say where you are - it did not do at all.
// On a phone that row became a horizontal scroll strip with no edge, so half
// the destinations existed only if you happened to swipe.
//
// Labels and routes are untouched. This is muscle memory for two people who
// use it every day, and the fix here is about which of these nine things you
// are looking at, not what they are called.
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
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  // On a phone the nav scrolls sideways, and the page you are on can easily sit
  // off the right edge - so the one item you most need to see is the one you
  // cannot. Pull it into view on load.
  //
  // Scrolls the strip itself rather than calling scrollIntoView, which would
  // also scroll the PAGE and drop you below the header you just tapped.
  useEffect(() => {
    const link = activeRef.current;
    const scroller = scrollerRef.current;
    if (!link || !scroller) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;

    const target = link.offsetLeft - (scroller.clientWidth - link.offsetWidth) / 2;
    scroller.scrollTo({
      left: Math.max(0, target),
      // Jumping is right here: this runs on load, and an animated slide on
      // arrival reads as the page still settling.
      behavior: "auto",
    });
  }, [pathname]);

  // Two hairlines, in the order the items are already in: the four everybody
  // has, the four only an owner has, then Settings. The rule is the divider
  // marks a change in WHO an item is for - it is the only thing about these
  // nine links that is not obvious from reading them.
  const withRules = items.map((item, i) => ({
    item,
    rule: i > 0 && items[i - 1].owner !== item.owner,
  }));

  return (
    <nav className="crm-nav" ref={scrollerRef} aria-label="CRM sections">
      <ul className="crm-nav-list">
        {withRules.map(({ item, rule }) => {
          const active = isActive(pathname, base, item);
          return (
            <li key={item.href} className={rule ? "crm-nav-li crm-nav-rule" : "crm-nav-li"}>
              <Link
                href={`${base}${item.href}`}
                ref={active ? activeRef : undefined}
                className={`crm-nav-link${active ? " crm-nav-link-on" : ""}`}
                // The styling says where you are to anyone who can see it;
                // this is the same fact for anyone who cannot.
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
