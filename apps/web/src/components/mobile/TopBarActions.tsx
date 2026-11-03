import { useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageActiveContext, TopBarSlotContext } from "../../lib/mobileShell";

/**
 * A page's actions for the phone top bar ("Start over", "Save spot";
 * docs/mobile-redesign.md §3.1), rendered there from wherever the page is.
 * Renders nothing on desktop (no top bar) and while the page is hidden
 * behind another tab. Use `icon-button`s (components/mobile/mobile.css).
 */
export function TopBarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TopBarSlotContext);
  const active = useContext(PageActiveContext);
  if (!slot || !active) return null;
  return createPortal(children, slot);
}
