import type { Spot } from "@poker-solver/schema";

// Describing a saved Spot in words: the Library's rows and preview, and the
// phone Saved list (whose summarize() this is, moved here unchanged).

/** "UTG — 100bb, unopened pot": a spot with no name of its own. */
export function summarize(spot: Spot): string {
  const positions = spot.positions_in_hand.join("/");
  const raise = (spot.actions ?? []).find((a) => a.action === "raise");
  const situation = raise
    ? `facing a raise from ${raise.position}`
    : "unopened pot";
  return `${positions} — ${spot.effective_stack_bb}bb, ${situation}`;
}

/** The spot's name, or the summary for spots saved before names existed. */
export function displayName(spot: Spot): string {
  return spot.name?.trim() ? spot.name : summarize(spot);
}

/** A preflop chart (Ranges) or a postflop setup (Solve): by whether there's a board. */
export function spotKind(spot: Spot): "preflop" | "postflop" {
  return (spot.board ?? []).length > 0 ? "postflop" : "preflop";
}

const GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

/** "Q♠ 5♣ 2♣". */
export function boardText(cards: readonly string[]): string {
  return cards.map((c) => `${c[0]}${GLYPH[c[1]?.toLowerCase()] ?? c[1] ?? ""}`).join(" ");
}

/** "Oct 7, 3:49 PM", or null when the date is missing or unreadable. */
export function shortSavedAt(spot: Spot): string | null {
  if (!spot.created_at) return null;
  const date = new Date(spot.created_at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
