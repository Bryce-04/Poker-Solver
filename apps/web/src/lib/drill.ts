// Swipe Drill: pure logic -- the deck's data shape, how a chosen action is
// graded against the solver's mixed strategy, and how an action label is
// shown. No React in here so it's testable on its own. See docs/plan.md's
// "Swipe Drill" section for the design.

/** A solver action label, exactly as `range_cfr` / `betting_round.py` emit it. */
export type DrillAction =
  | "fold"
  | "check"
  | "call"
  | "bet_small"
  | "bet_medium"
  | "bet_large"
  | "all_in";

/** What the hero is up against when the card is shown. */
export type DrillSituation =
  /** Out of position, first to act on the flop. */
  | "first_to_act"
  /** In position, villain checked. */
  | "facing_check"
  /** In position, villain bet. `facing` says which size. */
  | "facing_bet";

/** The "why" for a hand, computed offline by apps/api's drill_analysis.py. */
export interface DrillAnalysis {
  /** Plain-text bullets, in reading order: the hand, the range, the reason, a caveat. */
  bullets: string[];
  facts: {
    /** e.g. "top pair", "a nut flush draw", "ace high". */
    hand: string;
    draws: string[];
    board: string;
    /** This hand's equity against the opponent's range, %. */
    equityPct: number;
    /** Share of the player's range this hand beats on equity, %. */
    rangePercentile: number;
    /** The player's whole-range equity on this board, %. */
    rangeEquityPct: number;
  };
}

export interface DrillSpot {
  id: string;
  /** Flop, e.g. ["Ks", "7h", "2d"]. */
  board: string[];
  heroPosition: string;
  villainPosition: string;
  situation: DrillSituation;
  /** Villain's bet, when situation is "facing_bet". */
  facing?: DrillAction;
  /** Pot before any flop action, in bb. */
  potBb: number;
  /** Each player's remaining stack at the start of the flop, in bb. */
  stackBb: number;
  /** Hero's two hole cards, e.g. ["Ah", "Kh"]. */
  hand: [string, string];
  /** Hero's legal actions here, in the solver's own order. */
  actions: DrillAction[];
  /** Solver frequency (0..1) for every legal action, for this exact hand. */
  mix: Record<string, number>;
  /** Absent in a deck generated before analyses existed. */
  analysis?: DrillAnalysis;
}

export interface DrillDeck {
  id: string;
  name: string;
  description: string;
  spots: DrillSpot[];
}

export interface DrillDeckFile {
  /** How precisely the deck's spots were solved: worst exploitability, % of pot. */
  worstExploitabilityPct: number;
  decks: DrillDeck[];
}

export type Verdict = "best" | "good" | "miss";

export interface Grade {
  verdict: Verdict;
  /** 1 for a best move, 0.5 for a real-but-smaller frequency, 0 for a miss. */
  points: number;
  /** The solver's frequency for the action that was chosen. */
  frequency: number;
  /** The action the solver plays most often for this hand. */
  topAction: DrillAction;
}

/** At or above this share an action is a "best" move on frequency alone. */
export const BEST_FREQUENCY = 0.4;
/** Between this and BEST_FREQUENCY it's a mixed-in play, worth half credit. */
export const GOOD_FREQUENCY = 0.1;

/**
 * Equilibrium strategies mix, so there's rarely one right answer. A choice
 * is "best" if the solver takes it at least 40% of the time *or* it is the
 * solver's single most frequent action (a hand split 34/33/33 shouldn't have
 * every answer marked wrong), "good" at 10-40%, and a miss below that.
 */
export function gradeAction(spot: DrillSpot, chosen: DrillAction): Grade {
  const frequency = spot.mix[chosen] ?? 0;
  let topAction = spot.actions[0];
  for (const a of spot.actions) {
    if ((spot.mix[a] ?? 0) > (spot.mix[topAction] ?? 0)) topAction = a;
  }
  if (frequency >= BEST_FREQUENCY || chosen === topAction) {
    return { verdict: "best", points: 1, frequency, topAction };
  }
  if (frequency >= GOOD_FREQUENCY) {
    return { verdict: "good", points: 0.5, frequency, topAction };
  }
  return { verdict: "miss", points: 0, frequency, topAction };
}

export const AGGRESSIVE: ReadonlySet<DrillAction> = new Set([
  "bet_small",
  "bet_medium",
  "bet_large",
  "all_in",
]);

const SIZE_PCT: Record<string, number> = {
  bet_small: 25,
  bet_medium: 75,
  bet_large: 125,
};

// The solver's BET_SIZE_MENU as fractions; keep in step with betting_round.py.
const SIZE_FRACTION: Record<string, number> = {
  bet_small: 0.25,
  bet_medium: 0.75,
  bet_large: 1.25,
};

/** The passive choices (fold / check / call), in the solver's own order. */
export function passiveActions(spot: DrillSpot): DrillAction[] {
  return spot.actions.filter((a) => !AGGRESSIVE.has(a));
}

/** Every bet or raise size that's legal here, smallest first, all-in last. */
export function aggressiveActions(spot: DrillSpot): DrillAction[] {
  return spot.actions.filter((a) => AGGRESSIVE.has(a));
}

/** How bet sizes are written: bb first with the pot % small, or the reverse. */
export type BetDisplay = "bb" | "pct";

/** Trims a bb amount to one decimal without a trailing ".0" (97.5, 4.1, 12). */
export function formatBb(amount: number): string {
  return String(Number(amount.toFixed(1)));
}

/**
 * The chips an action puts in on this street, in bb -- the same arithmetic as
 * services/solver's betting_round.py, so the numbers shown match what was
 * solved: a bet is a fraction of the pot, a raise is the call plus a fraction
 * of the pot after calling (shown as the total, "raise to"), all-in is the
 * whole stack. Null for fold / check.
 */
export function actionAmountBb(spot: DrillSpot, action: DrillAction): number | null {
  const toCall = spot.situation === "facing_bet" ? betAmount(spot) : 0;
  switch (action) {
    case "fold":
    case "check":
      return null;
    case "call":
      return toCall;
    case "all_in":
      return spot.stackBb;
    default: {
      const frac = SIZE_FRACTION[action];
      const amount =
        toCall > 0 ? toCall + frac * (spot.potBb + 2 * toCall) : frac * spot.potBb;
      return Math.min(amount, spot.stackBb);
    }
  }
}

/** The villain's bet the hero is facing, in bb (0 when not facing one). */
export function betAmount(spot: DrillSpot): number {
  if (spot.situation !== "facing_bet" || !spot.facing) return 0;
  return Math.min((SIZE_FRACTION[spot.facing] ?? 0) * spot.potBb, spot.stackBb);
}

export interface ActionText {
  main: string;
  sub: string | null;
}

/** A button's two lines: the headline and the small secondary figure. */
export function actionParts(spot: DrillSpot, action: DrillAction, mode: BetDisplay): ActionText {
  const bb = actionAmountBb(spot, action);
  if (action === "fold") return { main: "Fold", sub: null };
  if (action === "check") return { main: "Check", sub: null };
  if (action === "call") return { main: "Call", sub: bb ? `${formatBb(bb)}bb` : null };
  if (action === "all_in") return { main: "All-in", sub: `${formatBb(spot.stackBb)}bb` };
  const pct = `${SIZE_PCT[action]}%`;
  const amount = `${formatBb(bb ?? 0)}bb`;
  return mode === "bb" ? { main: amount, sub: `${pct} pot` } : { main: pct, sub: amount };
}

/** One-line description for the feedback list: "Bet 4.1bb (75%)". */
export function actionText(spot: DrillSpot, action: DrillAction, mode: BetDisplay): string {
  const { main, sub } = actionParts(spot, action, mode);
  if (action === "fold" || action === "check" || action === "call" || action === "all_in") {
    return sub ? `${main} ${sub}` : main;
  }
  const verb = isFacingBet(spot) ? "Raise to" : "Bet";
  return `${verb} ${main} (${sub?.replace(" pot", "")})`;
}

export function isFacingBet(spot: DrillSpot): boolean {
  return spot.situation === "facing_bet";
}

/** Deterministic shuffle (mulberry32), so a session can be replayed from a seed. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
