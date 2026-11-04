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

/**
 * Puts a dot on the Solve tab, or takes it off with null (docs/mobile-redesign.md
 * §4.4: a solve running or a result not yet seen). The text ("solving") is
 * what a screen reader hears. Null on desktop.
 */
export const SolveBadgeContext = createContext<((badge: string | null) => void) | null>(null);

/** Marks the history entry an open BottomSheet pushes (so Back closes it). */
export const SHEET_ENTRY = "bottomSheet";

/**
 * True while the current history entry is an open sheet's. A step change
 * made from inside a sheet should replace that entry rather than push past
 * it, or Back would land on the stale sheet entry instead of the step before.
 */
export function onSheetEntry(): boolean {
  return Boolean(window.history.state?.[SHEET_ENTRY]);
}

/** A page's own top-bar title with a back arrow (TopBarTitle). */
export interface TopBarTitleOverride {
  title: string;
  /** What the back arrow says to a screen reader: "Back to setup". */
  backLabel: string;
  onBack: () => void;
}

/** Sets or clears the top bar's title override. Null on desktop. */
export const TopBarTitleContext = createContext<((override: TopBarTitleOverride | null) => void) | null>(null);
