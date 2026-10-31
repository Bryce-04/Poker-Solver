import type { ReactNode } from "react";
import type { NavId } from "../../lib/navigation";

// Icons from the agreed mockups (docs/desktop-redesign/mockup,
// docs/mobile-redesign/mockup): stroke icons drawn in currentColor so they
// follow the nav item's text color. The desktop sidebar and the phone tab bar
// both draw from here.
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

/** One nav destination's icon, decorative (the link carries the label). */
export function NavIcon({ id, size, className }: { id: NavId; size: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[id]}
    </svg>
  );
}
