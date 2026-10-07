// Fixed left-to-right order so every cell's segments line up the same way
// (StrategyGrid) and summaries list actions consistently. Covers every
// action betting_round.py's fixed menu can ever produce.
export const ACTION_ORDER = [
  "fold",
  "check",
  "call",
  "bet_small",
  "bet_medium",
  "bet_large",
  "all_in",
] as const;

export const ACTION_LABEL: Record<string, string> = {
  fold: "Fold",
  check: "Check",
  call: "Call",
  bet_small: "Bet Small (25%)",
  bet_medium: "Bet Medium (75%)",
  bet_large: "Bet Large (125%)",
  all_in: "All-in",
};

export type Strategy = Record<string, Record<string, number>>;

/**
 * The solver's average action mix across every hand it reported, each hand
 * counted equally (not weighted by combo count -- the response doesn't
 * carry combo weights). Actions under 0.5% are dropped so the headline
 * stays readable; result is in ACTION_ORDER.
 */
export function overallMix(strategy: Strategy): [string, number][] {
  const hands = Object.values(strategy);
  if (hands.length === 0) return [];
  const totals: Record<string, number> = {};
  for (const hand of hands) {
    for (const [action, prob] of Object.entries(hand)) {
      totals[action] = (totals[action] ?? 0) + prob;
    }
  }
  return ACTION_ORDER.filter((a) => a in totals)
    .map((a): [string, number] => [a, totals[a] / hands.length])
    .filter(([, share]) => share >= 0.005);
}

/** "Check 38%, Bet Small (25%) 62%" -- the plain-English form of a mix. */
export function formatMix(mix: [string, number][]): string {
  return mix.map(([a, p]) => `${ACTION_LABEL[a] ?? a} ${Math.round(p * 100)}%`).join(", ");
}
