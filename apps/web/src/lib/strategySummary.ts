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
 * The solver's average action mix across the hands it reported. With
 * `mass` (hand -> how many combos' worth of it are in the range, from
 * rangeCombos.handMass) each hand counts for how much of the range it
 * really is, and hands with no mass don't count at all; without it every
 * hand counts equally, which overstates hands that are barely in the range
 * (a narrowed range's near-zero hands looked as important as its core).
 * Actions under 0.5% are dropped so the headline stays readable; result is
 * in ACTION_ORDER.
 */
export function overallMix(
  strategy: Strategy,
  mass?: Record<string, number>,
): [string, number][] {
  const totals: Record<string, number> = {};
  let denominator = 0;
  for (const [hand, mix] of Object.entries(strategy)) {
    const weight = mass ? (mass[hand] ?? 0) : 1;
    if (weight <= 0) continue;
    denominator += weight;
    for (const [action, prob] of Object.entries(mix)) {
      totals[action] = (totals[action] ?? 0) + weight * prob;
    }
  }
  if (denominator === 0) return [];
  return ACTION_ORDER.filter((a) => a in totals)
    .map((a): [string, number] => [a, totals[a] / denominator])
    .filter(([, share]) => share >= 0.005);
}

/** "Check 38%, Bet Small (25%) 62%" -- the plain-English form of a mix. */
export function formatMix(mix: [string, number][]): string {
  return mix.map(([a, p]) => `${ACTION_LABEL[a] ?? a} ${Math.round(p * 100)}%`).join(", ");
}
