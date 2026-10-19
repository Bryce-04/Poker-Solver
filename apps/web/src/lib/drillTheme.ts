// The Swipe Drill's table-color choice. Only the drill's scene is themed (the
// CSS lives under `.game[data-theme=...]` in pages/DrillPage.css); verdict
// colors, solver-bar colors and the white card faces stay fixed on purpose.

export type DrillThemeId = "purple" | "midnight" | "ocean" | "emerald";

export interface DrillTheme {
  id: DrillThemeId;
  label: string;
  /** Swatch colors, and the browser/status-bar color while the drill is open. */
  felt: string;
  edge: string;
  rail: string;
  rim: string;
  chrome: string;
}

export const DRILL_THEMES: readonly DrillTheme[] = [
  { id: "purple", label: "Purple", felt: "#7c4fe0", edge: "#46228f", rail: "#241048", rim: "#8b6bd9", chrome: "#3b1a7a" },
  { id: "midnight", label: "Midnight", felt: "#43434d", edge: "#1d1d23", rail: "#0a0a0d", rim: "#7d7d8b", chrome: "#26262d" },
  { id: "ocean", label: "Ocean", felt: "#3f7fe0", edge: "#173f8a", rail: "#0a1e4a", rim: "#7fb0f5", chrome: "#14407f" },
  { id: "emerald", label: "Emerald", felt: "#2f9467", edge: "#145238", rail: "#08261b", rim: "#6fcfa3", chrome: "#0f5238" },
];

export const DEFAULT_THEME: DrillThemeId = "purple";
const KEY = "drill.theme";

export function isThemeId(value: unknown): value is DrillThemeId {
  return DRILL_THEMES.some((t) => t.id === value);
}

export function themeById(id: DrillThemeId): DrillTheme {
  return DRILL_THEMES.find((t) => t.id === id) ?? DRILL_THEMES[0];
}

export function readTheme(): DrillThemeId {
  try {
    const raw = localStorage.getItem(KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeTheme(id: DrillThemeId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // A remembered color is a nicety; private mode shouldn't break the game.
  }
}
