import { createContext, useContext } from "react";

/**
 * What the phone shell (App.tsx, docs/mobile-redesign.md §3) shares with the
 * pages inside it. On desktop none of these are provided, so the hooks return
 * their "not on a phone" defaults and pages can call them unconditionally.
 */

/** The top bar's slot that a page's actions render into (TopBarActions). */
export const TopBarSlotContext = createContext<HTMLElement | null>(null);

/**
 * False while a page is kept mounted but hidden behind another tab (Solve,
 * App.tsx), so it doesn't put its actions in the visible top bar.
 */
export const PageActiveContext = createContext(true);

/** Opens the account sheet; null when there's no phone shell (desktop). */
export const AccountSheetContext = createContext<(() => void) | null>(null);

/**
 * A function that opens the phone account sheet, or null on desktop (where
 * the sidebar has its own sign-in). Use it wherever a signed-out phone user
 * needs to sign in: Save, the signed-out Library.
 */
export function useOpenAccountSheet(): (() => void) | null {
  return useContext(AccountSheetContext);
}
