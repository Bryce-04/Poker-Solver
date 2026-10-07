import type { BettingAction, Position, Street } from "@poker-solver/schema";

// Backs SolvePage's click-through hand builder: walk preflop then flop then
// turn then river as a sequence of real actions (not the solver's
// bet_small/bet_medium/bet_large/all_in menu -- that's a backend
// abstraction apps/api/app/solve.py buckets an arbitrary size onto at solve
// time, disclosed via the response's bucketed_actions, see
// docs/decisions.md's 2026-10-07 entry), deriving pot_bb/effective_stack_bb
// for whichever street the user stops at instead of typing them in. Same
// goal as lib/parseHandHistory.ts's parseHandHistoryToPostflopSetup (reading
// what happened, not solving it), just built by clicking instead of
// pasting -- SolvePage offers both as alternative "Jump to a decision"
// modes, not one replacing the other.

export type BuilderActionType = "fold" | "check" | "call" | "bet" | "raise" | "all_in";

export interface BuilderAction {
  position: Position;
  action: BuilderActionType;
  /** Total bb this player has put in THIS street once this action lands --
   * "raises to X" semantics, matching parseHandHistory.ts's SET-not-ADD
   * convention (a raise size describes the new total, not an increment).
   * Required for "bet"/"raise", unused otherwise. */
  toBb?: number;
}

export const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river"];

export interface StreetContext {
  oopPosition: Position;
  ipPosition: Position;
  /** Dead money already in the pot before this street's own action. */
  potBeforeBb: number;
  /** Each player's remaining stack at the start of this street (symmetric
   * -- true once any earlier street closed via a call, since closing
   * requires matching the opponent's contribution exactly). */
  stackBeforeBb: number;
  firstToAct: Position;
  /** Preflop only: the blinds are already-posted starting contributions
   * this street, not actions a player chose -- everywhere else both
   * start at 0. */
  initialContributed?: Partial<Record<Position, number>>;
  isPreflop?: boolean;
}

export interface StreetState {
  toAct: Position;
  facingBet: boolean;
  toCallBb: number;
  /** Suggested label for the next aggressive action -- "bet" when nobody's
   * put in anything beyond blinds/calls yet, "raise" once there's a live
   * wager to raise over (matches real hand-history wording). */
  aggressiveLabel: "bet" | "raise";
  potNowBb: number;
  remainingBb: Record<Position, number>;
  isTerminal: boolean;
  folded: Position | null;
  /** Only meaningful once isTerminal && !folded. */
  potAfterBb: number;
  stackAfterBb: number;
}

function other(ctx: { oopPosition: Position; ipPosition: Position }, p: Position): Position {
  return p === ctx.oopPosition ? ctx.ipPosition : ctx.oopPosition;
}

/** Walks one street's actions from a starting context, returning whose turn
 * it is, what they're facing, and (once the street closes) the pot/stack
 * carried into the next street. Pure bookkeeping -- no legality engine, no
 * fixed bet-size menu, just real contribution math (the same shape
 * parseHandHistory.ts's accumulator already uses for pasted text). */
export function computeStreetState(ctx: StreetContext, actions: BuilderAction[]): StreetState {
  const contributed: Record<Position, number> = {
    [ctx.oopPosition]: ctx.initialContributed?.[ctx.oopPosition] ?? 0,
    [ctx.ipPosition]: ctx.initialContributed?.[ctx.ipPosition] ?? 0,
  } as Record<Position, number>;

  let toAct = ctx.firstToAct;
  let folded: Position | null = null;
  let last: BuilderActionType | null = null;

  for (const entry of actions) {
    if (entry.action === "fold") {
      folded = entry.position;
    } else if (entry.action === "call") {
      contributed[entry.position] = contributed[other(ctx, entry.position)];
    } else if (entry.action === "all_in") {
      contributed[entry.position] = ctx.stackBeforeBb;
    } else if (entry.action === "bet" || entry.action === "raise") {
      contributed[entry.position] = entry.toBb ?? contributed[entry.position];
    }
    last = entry.action;
    toAct = other(ctx, entry.position);
  }

  // Heads-up preflop's one wrinkle: the small blind "calling" to complete
  // just matches the big blind -- it doesn't close the street, since the
  // big blind hasn't had a turn yet (they posted involuntarily).
  const isCompletingBlindCall =
    !!ctx.isPreflop && actions.length === 1 && actions[0].action === "call";

  // A check closes the round unless it's literally the street's first
  // action (the other player still needs their turn) -- this also
  // correctly closes preflop's "limp, then big blind checks" sequence,
  // without needing a second preflop-specific special case: by the time
  // the big blind checks, the blind-completing call has already made it
  // not the first action.
  const isTerminal =
    folded !== null ||
    (last === "call" && !isCompletingBlindCall) ||
    (last === "check" && actions.length > 1);

  const facingBet = contributed[ctx.oopPosition] !== contributed[ctx.ipPosition];
  const toCallBb = facingBet ? Math.abs(contributed[toAct] - contributed[other(ctx, toAct)]) : 0;
  const potNowBb = ctx.potBeforeBb + contributed[ctx.oopPosition] + contributed[ctx.ipPosition];
  const bothAtZero = contributed[ctx.oopPosition] === 0 && contributed[ctx.ipPosition] === 0;

  return {
    toAct,
    facingBet,
    toCallBb,
    aggressiveLabel: bothAtZero ? "bet" : "raise",
    potNowBb,
    remainingBb: {
      [ctx.oopPosition]: ctx.stackBeforeBb - contributed[ctx.oopPosition],
      [ctx.ipPosition]: ctx.stackBeforeBb - contributed[ctx.ipPosition],
    } as Record<Position, number>,
    isTerminal,
    folded,
    potAfterBb: potNowBb,
    stackAfterBb:
      ctx.stackBeforeBb - Math.max(contributed[ctx.oopPosition], contributed[ctx.ipPosition]),
  };
}

export interface HandSummary {
  /** The furthest street the board's card count allows building action on
   * -- "preflop" if the board has fewer than 3 cards yet. */
  targetStreet: Street;
  /** pot_bb/effective_stack_bb entering targetStreet -- what a solve
   * submits, once nothing is blocking it. */
  potBb: number;
  effectiveStackBb: number;
  /** targetStreet's own state (whose turn, terminal, etc). */
  targetState: StreetState;
  /** Set once an earlier street folded, or hasn't closed yet but the board
   * already has more cards than that street allows -- either way, nothing
   * downstream is solvable until it's resolved. */
  blockedReason: string | null;
}

/** Walks preflop -> flop -> turn -> river in order, carrying pot/stack
 * forward through whichever streets are already closed, and stopping at
 * the street the board's card count implies. Heads-up blinds (1bb/0.5bb)
 * are assumed -- see CLAUDE.md's "assume 1/2 blinds for now" note. */
export function summarizeHand(
  oopPosition: Position,
  ipPosition: Position,
  startingStackBb: number,
  streets: Record<Street, BuilderAction[]>,
  boardLength: number,
): HandSummary {
  // The board's card count is only a REQUEST for how far to walk -- if an
  // earlier street hasn't closed (or folded), the walk stops there
  // instead, and targetStreet below reflects where it actually stopped,
  // not the board-length guess. That's what the UI keys "which street is
  // live right now" off of.
  const requestedStreet: Street =
    boardLength >= 5 ? "river" : boardLength >= 4 ? "turn" : boardLength >= 3 ? "flop" : "preflop";

  let potBb = 0;
  let stackBb = startingStackBb;
  let blockedReason: string | null = null;
  let targetStreet: Street = "preflop";
  let targetState: StreetState | null = null;

  for (const street of STREET_ORDER) {
    const isPreflop = street === "preflop";
    const ctx: StreetContext = {
      oopPosition,
      ipPosition,
      potBeforeBb: potBb,
      stackBeforeBb: stackBb,
      firstToAct: isPreflop ? ipPosition : oopPosition,
      initialContributed: isPreflop ? { [oopPosition]: 1, [ipPosition]: 0.5 } : undefined,
      isPreflop,
    };
    const state = computeStreetState(ctx, streets[street]);
    targetStreet = street;
    targetState = state;

    if (street === requestedStreet) {
      // potBb/stackBb already equal ctx.potBeforeBb/stackBeforeBb -- this
      // street's own action hasn't been folded into them (that's exactly
      // what a solve submits: pot/stack ENTERING the target street).
      break;
    }

    // This street isn't the requested one yet, so it must already be
    // closed (and not folded) for the walk to continue past it.
    if (state.folded) {
      blockedReason = `The hand already ended: ${state.folded} folded on the ${street}.`;
      break;
    }
    if (!state.isTerminal) {
      blockedReason = `Finish the ${street}'s action before moving on.`;
      break;
    }
    potBb = state.potAfterBb;
    stackBb = state.stackAfterBb;
  }

  return {
    targetStreet,
    potBb,
    effectiveStackBb: stackBb,
    // targetState is always assigned above (the loop runs at least once).
    targetState: targetState as StreetState,
    blockedReason,
  };
}

/** Maps one street's BuilderActions onto the schema's real BettingAction
 * shape for submission -- solve.py only ever reads the entries matching
 * Spot.current_street, so only the target street's actions need to be
 * sent. */
export function toBettingActions(street: Street, actions: BuilderAction[]): BettingAction[] {
  return actions.map((a) => ({
    position: a.position,
    street,
    action: a.action,
    ...(a.toBb !== undefined ? { size_bb: a.toBb } : {}),
  }));
}
