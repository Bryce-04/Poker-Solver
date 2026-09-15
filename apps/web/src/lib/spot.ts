import type { BettingAction, Position, Spot } from "@poker-solver/schema";

// Shared Spot-assembly helpers -- every entry path (button builder, Stage 3
// text parser, eventually Stage 4 hand-history import) must converge on the
// same Spot shape rather than each defining its own parallel construction.
// See CLAUDE.md's architecture note on packages/schema.

/** An unopened pot: hero is first to act. Matches the "open" reference charts. */
export function buildOpenSpot(position: Position, effectiveStackBb: number): Spot {
  return {
    positions_in_hand: [position],
    effective_stack_bb: effectiveStackBb,
    current_street: "preflop",
    actions: [],
  };
}

/**
 * Hero facing a single preflop raise from `raiser`. Matches the "defend"
 * reference charts. Raise size doesn't affect the chart match, so callers
 * don't need to supply one -- mirrors SpotBuilder's own comment on this.
 */
export function buildVsRaiseSpot(
  position: Position,
  raiser: Position,
  effectiveStackBb: number,
): Spot {
  const actions: BettingAction[] = [
    { position: raiser, street: "preflop", action: "raise" },
  ];
  return {
    positions_in_hand: [position],
    effective_stack_bb: effectiveStackBb,
    current_street: "preflop",
    actions,
  };
}
