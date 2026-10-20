import { useSyncExternalStore } from "react";

/** The desktop breakpoint, kept in step with desktop.css's media queries. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  // jsdom has no matchMedia: tests get the mobile layout unless they stub it.
  return typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
}

/**
 * True at >= 1024px (docs/desktop-redesign.md). For structural differences
 * CSS alone can't express -- the sidebar shell vs the top header. Pure
 * styling stays in desktop.css media queries.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
