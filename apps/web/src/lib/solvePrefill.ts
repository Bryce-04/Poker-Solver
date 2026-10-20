import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import type { BuilderAction } from "./handBuilder";

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

/** Route state from the Library's "Open": the saved spot itself. */
export function readSavedSpot(state: unknown): Spot | undefined {
  const spot = (state as { spot?: Partial<Spot> } | null)?.spot;
  if (
    spot &&
    Array.isArray(spot.positions_in_hand) &&
    spot.positions_in_hand.length >= 1 &&
    typeof spot.effective_stack_bb === "number"
  ) {
    return spot as Spot;
  }
  return undefined;
}

/** Everything Solve's setup starts from, rebuilt from a saved spot. */
export interface SolveSeed {
  setupMode: "click" | "paste";
  seatA: Position;
  seatB: Position;
  startingStackBb: number;
  streets: Record<Street, BuilderAction[]>;
  pickedCards: string[];
  ranges: Partial<Record<Position, HandRange>>;
  pastedPotBb: number;
  pastedStackBb: number;
  oopAlreadyChecked: boolean;
}

/**
 * Undo Solve's setupAsSpot (see docs/decisions.md's "Save spot" entry). A
 * clicked-through hand has preflop actions: they replay street by street
 * from effective_stack_bb, the starting stack. Without any, it came from a
 * hand history: pot and stack are the ones at the decision, and the only
 * possible action is the first player's check.
 */
export function seedFromSpot(spot: Spot): SolveSeed {
  const actions = spot.actions ?? [];
  const [seatA, seatB = seatA === "BB" ? "BTN" : "BB"] = spot.positions_in_hand;
  const streets: Record<Street, BuilderAction[]> = { preflop: [], flop: [], turn: [], river: [] };
  for (const a of actions) {
    streets[a.street ?? "preflop"].push({
      position: a.position,
      action: a.action,
      ...(a.size_bb !== undefined && a.size_bb !== null ? { toBb: a.size_bb } : {}),
    });
  }
  const click = streets.preflop.length > 0;
  return {
    setupMode: click ? "click" : "paste",
    seatA,
    seatB,
    startingStackBb: spot.effective_stack_bb,
    streets: click ? streets : { preflop: [], flop: [], turn: [], river: [] },
    pickedCards: spot.board ?? [],
    ranges: spot.ranges ?? {},
    pastedPotBb: click ? 0 : (spot.pot_bb ?? 0),
    pastedStackBb: click ? 0 : spot.effective_stack_bb,
    oopAlreadyChecked: !click && actions.some((a) => a.action === "check" && a.position === seatA),
  };
}
