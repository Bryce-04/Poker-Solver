import { NavLink } from "react-router-dom";
import { PHONE_NAV_ITEMS, type NavId } from "../../lib/navigation";
import { NavIcon } from "../NavIcon/NavIcon";
import "./TabBar.css";

/**
 * The phone bottom tab bar (docs/mobile-redesign.md §3.2): the four nav
 * destinations, each an icon over a label. `paths` is where each tab was
 * last left (App.tsx), so going back to a tab lands where you were; a tab
 * never visited goes to its root. `badges` puts a dot on a tab's icon (Solve,
 * while a solve runs or its result hasn't been seen).
 */
export function TabBar({
  paths,
  badges = {},
}: {
  paths: Partial<Record<NavId, string>>;
  badges?: Partial<Record<NavId, string>>;
}) {
  return (
    <nav className="tab-bar" aria-label="Main">
      <div className="tab-bar__inner">
        {PHONE_NAV_ITEMS.map((item) => (
          <NavLink key={item.id} to={paths[item.id] ?? item.to} className="tab-bar__item">
            <span className="tab-bar__icon">
              <NavIcon id={item.id} size={22} />
              {badges[item.id] && <span className="tab-bar__dot" aria-hidden="true" />}
            </span>
            {item.label}
            {badges[item.id] && (
              <>
                {" "}
                <span className="visually-hidden">({badges[item.id]})</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
