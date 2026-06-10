"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { businessName, coreServices, links, phoneDisplay } from "@/lib/site-data";

type SiteHeaderProps = {
  activeService?: string;
};

function CallIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
    </svg>
  );
}

export function SiteHeader({ activeService }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* ── Logo (horizontal) ── */}
        <Link href="/" className="logo-lockup" onClick={() => setMenuOpen(false)} aria-label={businessName}>
          <Image
            src="/images/logo_sideways_w_phrase.png"
            alt={businessName}
            width={320}
            height={72}
            className="h-11 w-auto md:h-12"
            priority
          />
        </Link>

        {/* ── Desktop nav (services) ── */}
        <nav className="location-nav" aria-label="Services">
          {coreServices.map((service) => (
            <Link
              key={service.slug}
              href={`/services/${service.slug}`}
              className={`nav-pill${activeService === service.slug ? " nav-pill--active" : ""}`}
            >
              {service.navLabel}
            </Link>
          ))}
        </nav>

        {/* ── Desktop CTAs ── */}
        <div className="header-ctas">
          <a href={links.call} className="hdr-call">
            <CallIcon />
            <span>{phoneDisplay}</span>
          </a>
          <a href="#quote" className="hdr-quote">
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
            {coreServices.map((service) => (
              <Link
                key={service.slug}
                href={`/services/${service.slug}`}
                className={`mobile-nav-link${activeService === service.slug ? " mobile-nav-link--active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                {service.name}
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
            <a href="#quote" className="hdr-quote" onClick={() => setMenuOpen(false)}>
              Get Free Quote
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
