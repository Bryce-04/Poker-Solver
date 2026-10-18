// Range chaining on the Solve page: narrow both players' ranges by what they
// did on each earlier postflop street, so a turn or river solve starts from
// ranges that line could actually have produced instead of a full preflop
// range. The narrowing itself is the server's (POST /spots/narrow, see
// docs/decisions.md's 2026-10-18 entry); this module only builds the
// requests and judges the answers.

import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { summarizeHand, toBettingActions } from "./handBuilder";
import type { BuilderAction } from "./handBuilder";

export type NarrowableStreet = "flop" | "turn";

const BOARD_LENGTH: Record<NarrowableStreet, number> = { flop: 3, turn: 4 };

/** The earlier postflop streets that narrow a solve of `target`, in order. */
export function streetsToNarrow(target: Street): NarrowableStreet[] {
  if (target === "river") return ["flop", "turn"];
  if (target === "turn") return ["flop"];
  return [];
}

/** "the flop", "the flop and turn" -- for button and status text. */
export function describeStreets(streets: readonly NarrowableStreet[]): string {
  return `the ${streets.join(" and ")}`;
}

export interface NarrowSpotInput {
  oopPosition: Position;
  ipPosition: Position;
  startingStackBb: number;
  streets: Record<Street, BuilderAction[]>;
  /** The full board entered so far; only the cards dealt by `street` are sent. */
  board: readonly string[];
  street: NarrowableStreet;
  oopRange: HandRange;
  ipRange: HandRange;
}

/** The /spots/narrow request for one street: that street's pot and stack
 * entering it, its own board, its recorded actions as the line to narrow on. */
export function buildNarrowSpot(input: NarrowSpotInput): Spot {
  const { oopPosition, ipPosition, street } = input;
  const boardLength = BOARD_LENGTH[street];
  const summary = summarizeHand(
    oopPosition,
    ipPosition,
    input.startingStackBb,
    input.streets,
    boardLength,
  );
  return {
    positions_in_hand: [oopPosition, ipPosition],
    effective_stack_bb: summary.effectiveStackBb,
    pot_bb: summary.potBb,
    // The schema types a board as a 0-5 tuple; a slice of 3 or 4 is one.
    board: input.board.slice(0, boardLength) as Spot["board"],
    current_street: street,
    actions: toBettingActions(street, input.streets[street]),
    ranges: { [oopPosition]: input.oopRange, [ipPosition]: input.ipRange },
  };
}

/** A line the equilibrium (almost) never plays leaves nothing real to narrow
 * to -- the server's ranges for it are numerical noise. Below this share of a
 * player's range taking their side of the line, refuse to build on it. */
export const MIN_LINE_PROBABILITY = 0.01;

/** Null when the line is plausible for both players; otherwise a sentence
 * saying who would (almost) never do that. */
export function unlikelyLineWarning(
  street: NarrowableStreet,
  probabilities: Record<string, number>,
): string | null {
  const unlikely = Object.entries(probabilities)
    .filter(([, p]) => p < MIN_LINE_PROBABILITY)
    .map(([position, p]) => `${position} (${(p * 100).toFixed(1)}%)`);
  if (unlikely.length === 0) return null;
  return (
    `In an equilibrium solve of the ${street}, ${unlikely.join(" and ")} almost never ` +
    `takes the line you entered, so there is no real range left to carry forward. ` +
    `Keep the ranges as they are, or change the ${street} action.`
  );
}
