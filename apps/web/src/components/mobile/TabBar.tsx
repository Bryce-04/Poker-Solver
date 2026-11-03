import { NavLink } from "react-router-dom";
import { NAV_ITEMS, type NavId } from "../../lib/navigation";
import { NavIcon } from "../NavIcon/NavIcon";
import "./TabBar.css";

/**
 * The phone bottom tab bar (docs/mobile-redesign.md §3.2): the four nav
 * destinations, each an icon over a label. `paths` is where each tab was
 * last left (App.tsx), so going back to a tab lands where you were; a tab
 * never visited goes to its root.
 */
export function TabBar({ paths }: { paths: Partial<Record<NavId, string>> }) {
  return (
    <nav className="tab-bar" aria-label="Main">
      <div className="tab-bar__inner">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.id} to={paths[item.id] ?? item.to} className="tab-bar__item">
            <NavIcon id={item.id} size={22} />
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
