import data from "../data/open-ranges.json";

// The reference opening ranges (100bb, 6-max) the "which hands to open"
// lesson grades against. The JSON is generated from apps/api's
// reference_charts.py by scripts/make_open_ranges.py, and a test there fails
// if the two drift apart.

export type OpenSeat = "UTG" | "HJ" | "CO" | "BTN" | "SB";

const RANGES = data as Record<OpenSeat, string[]>;

/** Seats in the order they widen, blinds left out (they play differently). */
export const POSITION_ORDER: readonly OpenSeat[] = ["UTG", "HJ", "CO", "BTN"];

/** Is this 169-type hand label ("KJo", "T9s", "55") in the seat's opening range? */
export function inOpenRange(seat: OpenSeat, label: string): boolean {
  return RANGES[seat].includes(label);
}

/** How many of the 1326 two-card combinations a 169-type label stands for. */
export function comboCount(label: string): number {
  if (label.length === 2) return 6; // a pair
  return label.endsWith("s") ? 4 : 12;
}

/** The share of all starting hands the seat opens, as a whole percent. */
export function openPercent(seat: OpenSeat): number {
  const combos = RANGES[seat].reduce((sum, label) => sum + comboCount(label), 0);
  return Math.round((combos / 1326) * 100);
}

/** The earliest seat (UTG, HJ, CO, BTN) that opens the hand, or null if none does. */
export function earliestOpeningSeat(label: string): OpenSeat | null {
  return POSITION_ORDER.find((seat) => inOpenRange(seat, label)) ?? null;
}

/** Two concrete cards for a hand label, for showing it: "AKo" -> ["As", "Kh"]. */
export function cardsFor(label: string): [string, string] {
  const [a, b] = [label[0], label[1]];
  if (label.length === 2) return [`${a}s`, `${b}h`];
  return label.endsWith("s") ? [`${a}s`, `${b}s`] : [`${a}s`, `${b}h`];
}

/** The open-or-fold explanation, from the range data. */
export function explainOpen(seat: OpenSeat, hand: string): string {
  const pct = openPercent(seat);
  if (inOpenRange(seat, hand)) {
    return `${hand} is in the ${seat} opening range, so it's a raise. The ${seat} opens about ${pct}% of hands.`;
  }
  const first = earliestOpeningSeat(hand);
  const later = first ? ` It becomes an open from the ${first} onward, where the range is wider.` : " It's too weak to open from any seat.";
  return `${hand} is not in the ${seat} opening range, so it's a fold. The ${seat} opens only about ${pct}% of hands.${later}`;
}

/** Every hand type the seat opens, as 169-type labels. */
export function openHands(seat: OpenSeat): readonly string[] {
  return RANGES[seat];
}
