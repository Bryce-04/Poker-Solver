// The Swipe Drill's remembered display setting (the table color lives in
// drillTheme.ts). Same shape: validated read, try/catch write.

import type { BetDisplay } from "./drill";

export const DEFAULT_BET_DISPLAY: BetDisplay = "bb";
const KEY = "drill.betDisplay";

export function readBetDisplay(): BetDisplay {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "bb" || raw === "pct" ? raw : DEFAULT_BET_DISPLAY;
  } catch {
    return DEFAULT_BET_DISPLAY;
  }
}

export function writeBetDisplay(mode: BetDisplay): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // A remembered setting is a nicety; private mode shouldn't break the game.
  }
}

// Haptics are opt-in: off until the player turns them on.
const HAPTICS_KEY = "drill.haptics";

export function readHaptics(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeHaptics(on: boolean): void {
  try {
    localStorage.setItem(HAPTICS_KEY, on ? "on" : "off");
  } catch {
    // A remembered setting is a nicety; private mode shouldn't break the game.
  }
}
