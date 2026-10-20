import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AuthStatus } from "../AuthStatus/AuthStatus";
import { NAV_ITEMS, type NavId } from "../../lib/navigation";
import "./Sidebar.css";

// Icons from the agreed mockup (docs/desktop-redesign/mockup), stroke
// icons drawn in currentColor so they follow the nav item's text color.
const ICONS: Record<NavId, ReactNode> = {
  solve: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  ranges: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  library: <path d="M6 3h12v18l-6-4-6 4V3z" />,
  drill: (
    <>
      <rect x="3" y="6" width="11" height="15" rx="2" />
      <path d="M9 3h10a2 2 0 0 1 2 2v12" />
    </>
  ),
};

/**
 * The desktop shell's left sidebar (docs/desktop-redesign.md §4): brand,
 * the four nav destinations with a one-line subtitle each, then a
 * beginner's-guide card and the account row at the bottom. Rendered only
 * at >= 1024px (App.tsx); phones keep the top header.
 */
export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2 4 14h6.5L9 22l11-13h-6.5L14 2z" fill="currentColor" />
        </svg>
        <span>Poker Solver</span>
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.id} to={item.to} className="sidebar__link">
            <svg
              className="sidebar__icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {ICONS[item.id]}
            </svg>
            <span className="sidebar__text">
              <span className="sidebar__label">{item.label}</span>
              <span className="sidebar__subtitle">{item.subtitle}</span>
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        {/* The spec leaves the guide's link target TBD (a static help page
            later), so this is a plain card until that page exists. */}
        <div className="sidebar__guide">
          <span className="sidebar__guide-title">New to solvers?</span>
          <span className="sidebar__guide-body">A 2-minute guide to reading the charts</span>
        </div>
        <AuthStatus variant="sidebar" />
      </div>
    </aside>
  );
}
