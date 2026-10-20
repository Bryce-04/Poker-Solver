import type { HandRange, Position, Spot } from "@poker-solver/schema";

/**
 * What another screen can hand Solve to start from (route state on
 * navigate("/solve")): the two seats and one player's range. Ranges' "Solve
 * a flop from here" builds it from the chart on screen.
 */
export interface SolvePrefill {
  /** The player whose range is given. */
  hero: Position;
  /** Their opponent: the raiser when facing a raise, else the big blind. */
  villain: Position;
  heroRange: HandRange;
  startingStackBb: number;
}

/** A preflop chart spot (open, or facing one raise) as a Solve prefill. */
export function prefillFromChartSpot(spot: Spot, heroRange: HandRange): SolvePrefill {
  const hero = spot.positions_in_hand[0];
  const raiser = (spot.actions ?? []).find((a) => a.action === "raise")?.position;
  return {
    hero,
    villain: raiser ?? (hero === "BB" ? "SB" : "BB"),
    heroRange,
    startingStackBb: spot.effective_stack_bb,
  };
}

/** Route state is untyped; accept it only if it has a prefill's shape. */
export function readSolvePrefill(state: unknown): SolvePrefill | undefined {
  const prefill = (state as { prefill?: Partial<SolvePrefill> } | null)?.prefill;
  if (
    prefill &&
    typeof prefill.hero === "string" &&
    typeof prefill.villain === "string" &&
    prefill.hero !== prefill.villain &&
    typeof prefill.heroRange === "object" &&
    prefill.heroRange !== null &&
    typeof prefill.startingStackBb === "number"
  ) {
    return prefill as SolvePrefill;
  }
  return undefined;
}
