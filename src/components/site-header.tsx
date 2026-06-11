"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import {
  businessName,
  commercialNav,
  links,
  phoneDisplay,
  residentialNav,
  type NavLink,
} from "@/lib/site-data";

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

function Caret() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function NavDropdown({
  label,
  items,
  activeService,
}: {
  label: string;
  items: NavLink[];
  activeService?: string;
}) {
  return (
    <div className="nav-dropdown">
      <button type="button" className="nav-dropdown-trigger">
        {label}
        <Caret />
      </button>
      <div className="nav-dropdown-panel" role="menu">
        {items.map((item) => (
          <Link
            key={`${label}-${item.slug}`}
            href={`/services/${item.slug}`}
            role="menuitem"
            className={`nav-dropdown-link${activeService === item.slug ? " nav-dropdown-link--active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function MobileGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavLink[];
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mobile-group">
      <button
        type="button"
        className="mobile-group-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span className={`mobile-group-caret${open ? " mobile-group-caret--open" : ""}`}>
          <Caret />
        </span>
      </button>
      {open && (
        <div className="mobile-group-items">
          {items.map((item) => (
            <Link
              key={`m-${label}-${item.slug}`}
              href={`/services/${item.slug}`}
              className="mobile-nav-link"
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader({ activeService }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        {/* ── Logo (horizontal) ── */}
        <Link href="/" className="logo-lockup" onClick={close} aria-label={businessName}>
          <Image
            src="/images/logo_horizontal.png"
            alt={businessName}
            width={967}
            height={243}
            className="h-11 w-auto md:h-12"
            priority
          />
        </Link>

        {/* ── Desktop nav ── */}
        <nav className="main-nav" aria-label="Primary">
          <NavDropdown label="Residential" items={residentialNav} activeService={activeService} />
          <NavDropdown label="Commercial" items={commercialNav} activeService={activeService} />
          <Link href="/#gallery" className="nav-link">
            Gallery
          </Link>
          <Link href="/#reviews" className="nav-link">
            Reviews
          </Link>
          <Link href="/#about" className="nav-link">
            About
          </Link>
        </nav>

        {/* ── Desktop CTAs ── */}
        <div className="header-ctas">
          <a href={links.call} className="hdr-call">
            <CallIcon />
            <span>{phoneDisplay}</span>
          </a>
          <a href="/#quote" className="hdr-quote">
            Free Estimate
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
            <MobileGroup label="Residential Services" items={residentialNav} onNavigate={close} />
            <MobileGroup label="Commercial Services" items={commercialNav} onNavigate={close} />
            <Link href="/#gallery" className="mobile-nav-link" onClick={close}>
              Gallery
            </Link>
            <Link href="/#reviews" className="mobile-nav-link" onClick={close}>
              Reviews
            </Link>
            <Link href="/#about" className="mobile-nav-link" onClick={close}>
              About
            </Link>
          </nav>
          <div className="mobile-menu-ctas">
            <a href={links.call} className="hdr-call" onClick={close}>
              <CallIcon />
              Call {phoneDisplay}
            </a>
            <a href={links.text} className="cta-secondary" onClick={close}>
              Text Now
            </a>
            <a href="/#quote" className="hdr-quote" onClick={close}>
              Free Estimate
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
