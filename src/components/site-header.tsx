"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { businessName, links, locationKeys, locations, phoneDisplay } from "@/lib/site-data";
import type { LocationKey } from "@/lib/site-data";

type SiteHeaderProps = {
  activeLocation?: LocationKey;
};

function CallIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
    </svg>
  );
}

export function SiteHeader({ activeLocation }: SiteHeaderProps) {
  const quoteHref = activeLocation ? "#quote" : "/raleigh#quote";
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* ── Logo (wordmark) ── */}
        <Link href="/" className="logo-lockup" onClick={() => setMenuOpen(false)} aria-label={businessName}>
          <Image
            src="/images/logo_main.png"
            alt={businessName}
            width={200}
            height={56}
            className="h-12 w-auto md:h-14"
            priority
          />
        </Link>

        {/* ── Desktop nav ── */}
        <nav className="location-nav" aria-label="Locations">
          {activeLocation ? (
            <Link href="/" className="nav-pill" onClick={() => setMenuOpen(false)}>
              Homepage
            </Link>
          ) : null}
          {locationKeys.map((key) => (
            <Link
              key={key}
              href={`/${key}`}
              className={`nav-pill${activeLocation === key ? " nav-pill--active" : ""}`}
            >
              {locations[key].city}
            </Link>
          ))}
        </nav>

        {/* ── Desktop CTAs ── */}
        <div className="header-ctas">
          <a href={links.call} className="hdr-call">
            <CallIcon />
            <span>{phoneDisplay}</span>
          </a>
          <a href={quoteHref} className="hdr-quote">
            Get Free Quote
          </a>
        </div>

        {/* ── Mobile hamburger ── */}
        <button
          className="hamburger"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className={`ham-bar${menuOpen ? " ham-bar--open-1" : ""}`} />
          <span className={`ham-bar${menuOpen ? " ham-bar--open-2" : ""}`} />
          <span className={`ham-bar${menuOpen ? " ham-bar--open-3" : ""}`} />
        </button>
      </div>

      {/* ── Mobile drawer ── */}
      {menuOpen && (
        <div className="mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation">
          <nav className="mobile-nav">
            {activeLocation ? (
              <Link href="/" className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                Homepage
              </Link>
            ) : null}
            {locationKeys.map((key) => (
              <Link
                key={key}
                href={`/${key}`}
                className={`mobile-nav-link${activeLocation === key ? " mobile-nav-link--active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                {locations[key].city}
              </Link>
            ))}
          </nav>
          <div className="mobile-menu-ctas">
            <a href={links.call} className="hdr-call" onClick={() => setMenuOpen(false)}>
              <CallIcon />
              Call {phoneDisplay}
            </a>
            <a href={links.text} className="cta-secondary" onClick={() => setMenuOpen(false)}>
              Text Now
            </a>
            <a href={quoteHref} className="hdr-quote" onClick={() => setMenuOpen(false)}>
              Get Free Quote
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
