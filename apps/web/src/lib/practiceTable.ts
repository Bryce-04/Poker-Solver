import opens from "../data/open-ranges.json";
import pairData from "../data/preflop-pairs.json";
import { RANKS } from "./hands";
import { explainOpen } from "./lessons";
import type { OpenSeat } from "./openRanges";

// The 6-max practice table's engine: pure logic, no React. A hand is dealt, the
// bots act from the reference charts up to your first decision, you act, and the
// bots answer from the same charts. Every decision of yours is graded against
// the charts, so the right answer and its explanation are worked out, not written.
//
// What this is NOT: a solver. The charts are the app's approximate reference
// ranges (apps/api preflop_ranges.py / reference_charts.py, 100bb), the bots play
// them exactly, and the hand stops where the charts run out (a call, a fold, or
// a 4-bet answered). Bet sizes are for display; the grading is range-based.
// See docs/decisions.md.

export type Seat = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export const SEATS: readonly Seat[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

export type Action = "fold" | "call" | "raise";
export type NodeKind = "open" | "vs-open" | "vs-3bet" | "vs-4bet";
/** What kind of first decision to practice. */
export type PracticeFilter = "all" | "open" | "defend";

export function isPracticeFilter(value: string | null): value is PracticeFilter {
  return value === "all" || value === "open" || value === "defend";
}

export const OPEN_TO = 2.5;
export const THREE_BET_TO = 9;
export const FOUR_BET_TO = 22;

const OPEN_RANGES = opens as Record<OpenSeat, string[]>;

interface PairRanges {
  flat: string[];
  threeBet: string[];
  callVs3: string[];
  fourBet: string[];
  callVs4: string[];
}
const PAIRS = pairData as Record<string, PairRanges>;
const pairFor = (opener: Seat, defender: Seat): PairRanges | undefined => PAIRS[`${opener}>${defender}`];

export type Rng = () => number;

/** A small seeded generator, so tests (and a "same hand again") are repeatable. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUITS = ["s", "h", "d", "c"] as const;
const DECK: readonly string[] = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`));

/** "Ah", "Kd" -> "AKo"; "Ah", "Kh" -> "AKs"; "7s", "7c" -> "77". */
export function labelFor(a: string, b: string): string {
  const [ra, rb] = [RANKS.indexOf(a[0] as (typeof RANKS)[number]), RANKS.indexOf(b[0] as (typeof RANKS)[number])];
  const [hi, lo] = ra <= rb ? [a, b] : [b, a];
  if (ra === rb) return `${hi[0]}${lo[0]}`;
  return `${hi[0]}${lo[0]}${a[1] === b[1] ? "s" : "o"}`;
}

export interface Deal {
  hero: Seat;
  hands: Record<Seat, [string, string]>;
}

export interface TableState {
  /** What each seat has put in front of it this hand, in bb. */
  bets: Record<Seat, number>;
  folded: Record<Seat, boolean>;
  /** What has happened so far, oldest first ("UTG folds", "CO raises to 2.5bb"). */
  log: string[];
}

export interface HeroNode {
  kind: NodeKind;
  seat: Seat;
  /** The bot you are facing, when there is one. */
  opponent: Seat | null;
  hand: string;
  options: Action[];
  correct: Action;
  explanation: string;
  table: TableState;
  /** The total to match (what the last raiser has in), and what a raise makes it. */
  toMatch: number;
  raiseTo: number | null;
}

export interface Outcome {
  correct: boolean;
  /** What the charts say to do. */
  best: Action;
  explanation: string;
  /** The table after your action and the bots' answers. */
  table: TableState;
  /** The next decision when the hand goes on (a 3-bet or 4-bet to face), else null. */
  next: HeroNode | null;
  /** One line on how the hand ended, when it did. */
  summary: string | null;
}

const bb = (n: number) => `${n}bb`;

function freshTable(): TableState {
  return {
    bets: { UTG: 0, HJ: 0, CO: 0, BTN: 0, SB: 0.5, BB: 1 },
    folded: { UTG: false, HJ: false, CO: false, BTN: false, SB: false, BB: false },
    log: [],
  };
}

function withLog(t: TableState, line: string, change?: (t: TableState) => void): TableState {
  const next: TableState = { bets: { ...t.bets }, folded: { ...t.folded }, log: [...t.log, line] };
  change?.(next);
  return next;
}

const fold = (t: TableState, seat: Seat) => withLog(t, `${seat} folds`, (n) => void (n.folded[seat] = true));
const raise = (t: TableState, seat: Seat, to: number, verb: string) =>
  withLog(t, `${seat} ${verb} to ${bb(to)}`, (n) => void (n.bets[seat] = to));
const call = (t: TableState, seat: Seat, to: number) =>
  withLog(t, `${seat} calls ${bb(to)}`, (n) => void (n.bets[seat] = to));

const seatsAfter = (seat: Seat): Seat[] => SEATS.slice(SEATS.indexOf(seat) + 1);
const seatsBefore = (seat: Seat): Seat[] => SEATS.slice(0, SEATS.indexOf(seat));

/** A seat name with its article for sentences: "the BTN". */
const the = (seat: Seat) => `the ${seat}`;

const labelOf = (deal: Deal, seat: Seat) => labelFor(...deal.hands[seat]);

// --- the explanations -------------------------------------------------------------------------

const NOTE = " These are the app's approximate reference ranges, not a solver's output.";

function explainVsOpen(hand: string, hero: Seat, opener: Seat, best: Action): string {
  const where = `against ${the(opener)}'s open from the ${hero}`;
  if (best === "raise") return `${hand} is a 3-bet ${where}: it is in the ${hero}'s 3-bet range.${NOTE}`;
  if (best === "call") return `${hand} is a call ${where}: strong enough to continue but not to 3-bet.${NOTE}`;
  return `${hand} is a fold ${where}: it is in neither the ${hero}'s calling nor 3-betting range.${NOTE}`;
}

function explainVs3bet(hand: string, hero: Seat, opponent: Seat, best: Action): string {
  const where = `facing ${the(opponent)}'s 3-bet after opening from the ${hero}`;
  if (best === "raise") return `${hand} is a 4-bet ${where}: it is in the ${hero}'s 4-bet range.${NOTE}`;
  if (best === "call") return `${hand} is a call ${where}: it is in the ${hero}'s calling range against a 3-bet.${NOTE}`;
  return `${hand} is a fold ${where}: it is in neither the calling nor the 4-betting range.${NOTE}`;
}

function explainVs4bet(hand: string, hero: Seat, opener: Seat, best: Action): string {
  const where = `facing ${the(opener)}'s 4-bet after 3-betting from the ${hero}`;
  return best === "call"
    ? `${hand} is a call ${where}: one of the hands that continue.${NOTE}`
    : `${hand} is a fold ${where}: it is not among the hands that continue against a 4-bet.${NOTE}`;
}

// --- building decisions -----------------------------------------------------------------------

function openNode(deal: Deal, table: TableState): HeroNode {
  const seat = deal.hero as OpenSeat;
  const hand = labelOf(deal, deal.hero);
  const inRange = OPEN_RANGES[seat].includes(hand);
  return {
    kind: "open",
    seat: deal.hero,
    opponent: null,
    hand,
    options: ["fold", "raise"],
    correct: inRange ? "raise" : "fold",
    explanation: `${explainOpen(seat, hand)}${NOTE}`,
    table,
    toMatch: 1,
    raiseTo: OPEN_TO,
  };
}

function vsOpenNode(deal: Deal, table: TableState, opener: Seat, pair: PairRanges): HeroNode {
  const hand = labelOf(deal, deal.hero);
  const best: Action = pair.threeBet.includes(hand) ? "raise" : pair.flat.includes(hand) ? "call" : "fold";
  return {
    kind: "vs-open",
    seat: deal.hero,
    opponent: opener,
    hand,
    options: ["fold", "call", "raise"],
    correct: best,
    explanation: explainVsOpen(hand, deal.hero, opener, best),
    table,
    toMatch: OPEN_TO,
    raiseTo: THREE_BET_TO,
  };
}

function vs3betNode(deal: Deal, table: TableState, defender: Seat, pair: PairRanges): HeroNode {
  const hand = labelOf(deal, deal.hero);
  const best: Action = pair.fourBet.includes(hand) ? "raise" : pair.callVs3.includes(hand) ? "call" : "fold";
  return {
    kind: "vs-3bet",
    seat: deal.hero,
    opponent: defender,
    hand,
    options: ["fold", "call", "raise"],
    correct: best,
    explanation: explainVs3bet(hand, deal.hero, defender, best),
    table,
    toMatch: THREE_BET_TO,
    raiseTo: FOUR_BET_TO,
  };
}

function vs4betNode(deal: Deal, table: TableState, opener: Seat, pair: PairRanges): HeroNode {
  const hand = labelOf(deal, deal.hero);
  const best: Action = pair.callVs4.includes(hand) ? "call" : "fold";
  return {
    kind: "vs-4bet",
    seat: deal.hero,
    opponent: opener,
    hand,
    options: ["fold", "call"],
    correct: best,
    explanation: explainVs4bet(hand, deal.hero, opener, best),
    table,
    toMatch: FOUR_BET_TO,
    raiseTo: null,
  };
}

/**
 * Plays the bots up to your first decision. The first seat whose hand is in its
 * opening range raises; the rest behind it fold (a simplification: they never
 * cold-call or 3-bet before you). Returns null for a spot the charts can't grade
 * (a defender with no chart against that opener, or the big blind with nobody
 * having raised), so the dealer just deals again.
 */
export function startNode(deal: Deal): HeroNode | null {
  let table = freshTable();
  let opener: Seat | null = null;
  for (const seat of seatsBefore(deal.hero)) {
    if (opener === null && seat !== "BB" && OPEN_RANGES[seat as OpenSeat].includes(labelOf(deal, seat))) {
      opener = seat;
      table = raise(table, seat, OPEN_TO, "raises");
    } else {
      table = fold(table, seat);
    }
  }
  if (opener === null) {
    return deal.hero === "BB" ? null : openNode(deal, table);
  }
  const pair = pairFor(opener, deal.hero);
  return pair ? vsOpenNode(deal, table, opener, pair) : null;
}

const KIND_OF_FILTER: Record<PracticeFilter, NodeKind[]> = {
  all: ["open", "vs-open"],
  open: ["open"],
  defend: ["vs-open"],
};

/** Deals hands until one lands on a decision the filter wants and the charts can grade. */
export function dealHand(rng: Rng, filter: PracticeFilter = "all"): { deal: Deal; node: HeroNode } {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const deck = [...DECK];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const hands = Object.fromEntries(SEATS.map((s, i) => [s, [deck[2 * i], deck[2 * i + 1]]])) as Deal["hands"];
    const hero = SEATS[Math.floor(rng() * SEATS.length)];
    const deal: Deal = { hero, hands };
    const node = startNode(deal);
    if (node && KIND_OF_FILTER[filter].includes(node.kind)) return { deal, node };
  }
  throw new Error("could not deal a hand the charts can grade");
}

// --- acting -----------------------------------------------------------------------------------

/**
 * Applies your action: grades it, lets the bots answer from the charts, and says
 * what comes next (another decision of yours, or the end of the hand).
 */
export function applyAction(deal: Deal, node: HeroNode, action: Action): Outcome {
  const correct = action === node.correct;
  const base = { correct, best: node.correct, explanation: node.explanation };
  const hero = node.seat;
  let table = node.table;

  const end = (t: TableState, summary: string): Outcome => ({ ...base, table: t, next: null, summary });
  const goOn = (t: TableState, next: HeroNode): Outcome => ({ ...base, table: t, next, summary: null });

  if (action === "fold") {
    return end(withLog(table, `You fold ${node.hand}`, (n) => void (n.folded[hero] = true)), "You folded.");
  }

  if (node.kind === "open") {
    table = raise(table, hero, OPEN_TO, "raise");
    for (const seat of seatsAfter(hero)) {
      const pair = pairFor(hero, seat);
      const botHand = labelOf(deal, seat);
      if (pair?.threeBet.includes(botHand)) {
        table = raise(table, seat, THREE_BET_TO, "3-bets");
        return goOn(table, vs3betNode(deal, table, seat, pair));
      }
      if (pair?.flat.includes(botHand)) {
        table = call(table, seat, OPEN_TO);
        return end(table, `${seat} called with ${botHand}. You see a flop.`);
      }
      table = fold(table, seat);
    }
    return end(table, "Everyone folded. You win the blinds.");
  }

  if (node.kind === "vs-open") {
    const opener = node.opponent as Seat;
    if (action === "call") {
      table = call(table, hero, OPEN_TO);
      // The others behind you fold; the hand goes to the flop with you and the opener.
      return end(table, `You call. It's you against ${the(opener)}, and you see a flop.`);
    }
    table = raise(table, hero, THREE_BET_TO, "3-bet");
    const pair = pairFor(opener, hero) as PairRanges;
    const botHand = labelOf(deal, opener);
    if (pair.fourBet.includes(botHand)) {
      table = raise(table, opener, FOUR_BET_TO, "4-bets");
      return goOn(table, vs4betNode(deal, table, opener, pair));
    }
    if (pair.callVs3.includes(botHand)) {
      table = call(table, opener, THREE_BET_TO);
      return end(table, `${opener} called your 3-bet with ${botHand}. You see a flop.`);
    }
    table = fold(table, opener);
    return end(table, `${opener} folded ${botHand} to your 3-bet. You win the pot.`);
  }

  if (node.kind === "vs-3bet") {
    const defender = node.opponent as Seat;
    if (action === "call") {
      table = call(table, hero, THREE_BET_TO);
      return end(table, `You call the 3-bet. You see a flop against ${the(defender)}.`);
    }
    table = raise(table, hero, FOUR_BET_TO, "4-bet");
    const pair = pairFor(hero, defender) as PairRanges;
    const botHand = labelOf(deal, defender);
    if (pair.callVs4.includes(botHand)) {
      table = call(table, defender, FOUR_BET_TO);
      return end(table, `${defender} called your 4-bet with ${botHand}. You see a flop.`);
    }
    table = fold(table, defender);
    return end(table, `${defender} folded ${botHand} to your 4-bet. You win the pot.`);
  }

  // vs-4bet: fold was handled above, so this is a call.
  table = call(table, hero, FOUR_BET_TO);
  return end(table, `You call the 4-bet. You see a flop against ${the(node.opponent as Seat)}.`);
}

/** The labels of the two buttons that aren't "Fold", worded for the decision. */
export function actionLabel(node: HeroNode, action: Action): string {
  if (action === "fold") return "Fold";
  if (action === "call") return `Call ${bb(node.toMatch)}`;
  const names: Record<NodeKind, string> = { open: "Raise", "vs-open": "3-bet", "vs-3bet": "4-bet", "vs-4bet": "Raise" };
  return `${names[node.kind]} to ${bb(node.raiseTo ?? node.toMatch)}`;
}

/** A one-line description of the spot, for the prompt and the coach. */
export function describeNode(node: HeroNode): string {
  const seat = node.seat;
  switch (node.kind) {
    case "open":
      return `You're in the ${seat} at 100bb and everyone has folded to you. Open or fold?`;
    case "vs-open":
      return `You're in the ${seat} at 100bb. ${node.opponent} raised to ${bb(OPEN_TO)} and the rest folded. What do you do?`;
    case "vs-3bet":
      return `You opened from the ${seat} and ${node.opponent} 3-bet to ${bb(THREE_BET_TO)}. What do you do?`;
    case "vs-4bet":
      return `You 3-bet from the ${seat} and ${node.opponent} 4-bet to ${bb(FOUR_BET_TO)}. What do you do?`;
  }
}

