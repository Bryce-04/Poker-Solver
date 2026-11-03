import { NavLink } from "react-router-dom";
import { AuthStatus } from "../AuthStatus/AuthStatus";
import { NavIcon } from "../NavIcon/NavIcon";
import { NAV_ITEMS } from "../../lib/navigation";
import "./Sidebar.css";

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
            <NavIcon id={item.id} size={18} className="sidebar__icon" />
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
