import type { HandRange, Position, Street } from "@poker-solver/schema";
import {
  STREET_ORDER,
  computeStreetState,
  preflopContext,
  type BuilderAction,
  type StreetContext,
  type StreetState,
} from "../../lib/handBuilder";
import { ACTION_LABEL } from "../../lib/strategySummary";
import { indexRange, labelWeight } from "../../lib/rangeCombos";

// Plain-English wording for the desktop Solve screen (docs/desktop-redesign.md
// §6.1-6.2). Pure functions over the hand builder's data, no new poker logic.

/** "check" / "bet small (25%)": an action as advice ("Usually check"). */
const ACTION_ADVICE: Record<string, string> = {
  fold: "fold",
  check: "check",
  call: "call",
  bet_small: "bet small (25%)",
  bet_medium: "bet medium (75%)",
  bet_large: "bet large (125%)",
  all_in: "go all-in",
};

/** "checks" / "bets small (25%)": an action as a player's habit. */
const ACTION_HABIT: Record<string, string> = {
  fold: "folds",
  check: "checks",
  call: "calls",
  bet_small: "bets small (25%)",
  bet_medium: "bets medium (75%)",
  bet_large: "bets large (125%)",
  all_in: "goes all-in",
};

const AGGRESSIVE = new Set(["bet_small", "bet_medium", "bet_large", "all_in"]);

const RAISE_NAME = ["raised", "3-bet", "4-bet", "5-bet"];

function isRaise(action: BuilderAction): boolean {
  return action.action === "raise" || action.action === "bet" || action.action === "all_in";
}

/** "BTN raised, BB called" -- the preflop line as it happened. */
export function describePreflop(actions: BuilderAction[]): string {
  let raises = 0;
  return actions
    .map((a) => {
      if (isRaise(a)) return `${a.position} ${RAISE_NAME[Math.min(raises++, 3)]}`;
      if (a.action === "call") return `${a.position} ${raises === 0 ? "limped" : "called"}`;
      if (a.action === "check") return `${a.position} checked`;
      return `${a.position} folded`;
    })
    .join(", ");
}

/** "single-raised pot" / "3-bet pot" / "limped pot". */
export function potType(preflopActions: BuilderAction[]): string {
  const raises = preflopActions.filter(isRaise).length;
  return raises === 0 ? "limped pot" : raises === 1 ? "single-raised pot" : `${raises + 1}-bet pot`;
}

/** What this player did preflop, for its range tab: "opened the pot",
 * "called the open", "3-bet". Empty when it hasn't acted. */
export function preflopRole(position: Position, preflopActions: BuilderAction[]): string {
  let raises = 0;
  let role = "";
  for (const a of preflopActions) {
    if (isRaise(a)) {
      if (a.position === position) role = raises === 0 ? "opened the pot" : RAISE_NAME[Math.min(raises, 3)];
      raises++;
    } else if (a.position === position) {
      role =
        a.action === "call"
          ? raises === 0
            ? "limped"
            : raises === 1
              ? "called the open"
              : `called the ${raises + 1}-bet`
          : a.action === "check"
            ? "checked its option"
            : "folded";
    }
  }
  return role;
}

export interface StreetBlock {
  street: Street;
  ctx: StreetContext;
  actions: BuilderAction[];
  state: StreetState;
}

/** Each street the hand has reached, with its starting pot/stack -- the same
 * walk summarizeHand does, kept per street for the action timeline. */
export function streetBlocks(
  oop: Position,
  ip: Position,
  startingStackBb: number,
  streets: Record<Street, BuilderAction[]>,
  targetStreet: Street,
): StreetBlock[] {
  const blocks: StreetBlock[] = [];
  let ctx: StreetContext = preflopContext(oop, ip, startingStackBb);
  for (const street of STREET_ORDER) {
    const state = computeStreetState(ctx, streets[street]);
    blocks.push({ street, ctx, actions: streets[street], state });
    if (street === targetStreet) break;
    ctx = {
      oopPosition: oop,
      ipPosition: ip,
      potBeforeBb: state.potAfterBb,
      stackBeforeBb: state.stackAfterBb,
      firstToAct: oop,
    };
  }
  return blocks;
}

/** One logged action in words: "BTN raises to 2.5bb", "BB calls". */
export function describeAction(a: BuilderAction): string {
  switch (a.action) {
    case "fold":
      return `${a.position} folds`;
    case "check":
      return `${a.position} checks`;
    case "call":
      return `${a.position} calls`;
    case "all_in":
      return `${a.position} goes all-in`;
    case "bet":
      return `${a.position} bets ${a.toBb}bb`;
    case "raise":
      return `${a.position} raises to ${a.toBb}bb`;
  }
}

/** Pot size after each action of a street, for the timeline's right column. */
export function runningPots(block: StreetBlock): number[] {
  return block.actions.map((_, i) => computeStreetState(block.ctx, block.actions.slice(0, i + 1)).potNowBb);
}

export function bb(n: number): string {
  return `${Math.round(n * 10) / 10}bb`;
}

export type AccuracyTier = "very" | "accurate" | "rough";

/** How much to trust a solve (§6.2): exploitability under 0.5% of the pot is
 * "very accurate", under 1.5% "accurate", anything else -- or a solve the
 * server cut short -- "rough". */
export function accuracyOf(
  exploitabilityPct: number | undefined,
  converged: boolean | undefined,
): { tier: AccuracyTier; title: string } {
  if (converged === false) return { tier: "rough", title: "Rough: treat close percentages loosely" };
  if (exploitabilityPct === undefined || exploitabilityPct < 0.5) return { tier: "very", title: "Very accurate" };
  if (exploitabilityPct < 1.5) return { tier: "accurate", title: "Accurate" };
  return { tier: "rough", title: "Rough: treat close percentages loosely" };
}

function byShare(mix: Record<string, number>): [string, number][] {
  return Object.entries(mix).sort(([, a], [, b]) => b - a);
}

/** The selected hand's advice line (§6.2's rules). */
export function handAdvice(mix: Record<string, number>, opponent: Position): string {
  const [[top, topShare] = ["check", 0], [second] = [""]] = byShare(mix);
  const topText = ACTION_ADVICE[top] ?? top;
  if (topShare >= 0.995) return `Always ${topText}.`;
  if (topShare >= 0.8) return `Almost always ${topText}.`;
  if (topShare >= 0.5) {
    return `Usually ${topText}, sometimes ${ACTION_ADVICE[second] ?? second}. Both are fine: the solver mixes on purpose so ${opponent} can't read your hand.`;
  }
  return "A close mix. Any of the top plays is fine. What matters is not always doing the same thing.";
}

/** "BB checks 77% of the time on this flop." */
export function headline(position: Position, street: Street, mix: [string, number][]): string {
  const [top, share] = [...mix].sort(([, a], [, b]) => b - a)[0] ?? ["check", 0];
  return `${position} ${ACTION_HABIT[top] ?? top} ${Math.round(share * 100)}% of the time on this ${street}.`;
}

/** One line on which hands take the aggressive line, from the strategy and
 * the range's mass -- e.g. "It bets most often with AA, KK, 55 and A5s." */
export function aggressionLine(
  strategy: Record<string, Record<string, number>>,
  mass: Record<string, number>,
  mix: [string, number][],
): string {
  const aggressiveShare = mix.filter(([a]) => AGGRESSIVE.has(a)).reduce((sum, [, p]) => sum + p, 0);
  if (aggressiveShare < 0.05) return "It almost never bets here: nearly the whole range checks or calls.";
  const leaders = Object.entries(strategy)
    .filter(([hand]) => (mass[hand] ?? 0) > 0)
    .map(([hand, m]): [string, number] => [
      hand,
      Object.entries(m).reduce((sum, [a, p]) => (AGGRESSIVE.has(a) ? sum + p : sum), 0),
    ])
    .filter(([, p]) => p >= 0.5)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([hand]) => hand);
  if (leaders.length === 0) return "It bets some of the time with many hands, rather than always with a few.";
  const list =
    leaders.length === 1 ? leaders[0] : `${leaders.slice(0, -1).join(", ")} and ${leaders[leaders.length - 1]}`;
  return `It bets most often with ${list}.`;
}

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** A note on the active range, when one applies (§6.1): a caller whose
 * premium pairs are only partly in its range. */
export function rangeNote(position: Position, role: string, range: HandRange): string | null {
  if (!role.startsWith("called")) return null;
  const index = indexRange(range);
  const partial = ["AA", "KK"].filter((h) => {
    const w = labelWeight(index, h);
    return w > 0 && w < 1;
  });
  if (partial.length === 0) return null;
  return `Big hands like AA and KK are only partly filled: ${position} usually re-raises (3-bets) them before the flop, so it rarely just calls with them.`;
}

export interface ExploreOption {
  label: string;
  action: BuilderAction;
  /** Closing the street: there's no decision left on it, so the next card is
   * needed before anything can be solved. */
  dealsNext: Street | null;
}

const NEXT_STREET: Partial<Record<Street, Street>> = { flop: "turn", turn: "river" };

/** "Keep exploring" (§6.2): the next actions worth solving from this node --
 * only legal ones, and only the cheap ones to explain (check, a small bet,
 * calling). */
export function exploreOptions(
  street: Street,
  state: StreetState,
  actions: BuilderAction[],
  oop: Position,
  ip: Position,
): ExploreOption[] {
  if (state.isTerminal || street === "preflop") return [];
  const actor = state.toAct;
  const other = actor === oop ? ip : oop;
  const next = NEXT_STREET[street] ?? null;
  const options: ExploreOption[] = [];
  if (state.facingBet) {
    if (next) {
      options.push({ label: `What if ${actor} calls? Deal a ${next} card`, action: { position: actor, action: "call" }, dealsNext: next });
    }
    return options;
  }
  if (actions.length === 0) {
    options.push({ label: `What does ${other} do if ${actor} checks?`, action: { position: actor, action: "check" }, dealsNext: null });
  } else if (next) {
    options.push({ label: `What if ${actor} checks too? Deal a ${next} card`, action: { position: actor, action: "check" }, dealsNext: next });
  }
  options.push({
    label: `What if ${actor} bets small?`,
    action: { position: actor, action: "bet", toBb: Math.round(state.potNowBb * 0.25 * 10) / 10 },
    dealsNext: null,
  });
  return options;
}
