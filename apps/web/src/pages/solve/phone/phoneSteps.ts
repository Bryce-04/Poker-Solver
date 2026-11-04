import type { Position } from "@poker-solver/schema";
import type { BuilderAction } from "../../../lib/handBuilder";
import { indexRange, totalCombos } from "../../../lib/rangeCombos";
import type { HandRange } from "@poker-solver/schema";
import { accuracyOf, type StreetBlock } from "../solveText";
import type { SolveSetup } from "../useSolveSetup";

// The phone Solve flow's pure logic (docs/mobile-redesign.md §4): which step
// is which, what's stopping each one, and the raise sheet's names and sizes.
// No React here, so it's tested on its own (phoneSteps.test.ts).

export type SolveStep = "hand" | "board" | "ranges" | "ready" | "result";

/** The four setup steps, in order, as the progress bar shows them. */
export const SETUP_STEPS = [
  { id: "hand", label: "Hand" },
  { id: "board", label: "Board" },
  { id: "ranges", label: "Ranges" },
  { id: "ready", label: "Solve" },
] as const satisfies readonly { id: SolveStep; label: string }[];

const ALL_STEPS: readonly SolveStep[] = ["hand", "board", "ranges", "ready", "result"];

/** The `?step=` value, if it names a step. */
export function readStep(param: string | null): SolveStep | null {
  return ALL_STEPS.find((s) => s === param) ?? null;
}

/** Why the hand step can't move on yet, as the Next button says it; null
 * once it can. */
export function handBlocker(s: SolveSetup): string | null {
  if (s.setupMode === "paste") return s.pasteLoaded ? null : "Paste a hand history first";
  if (!s.positionsAreValid) return "Pick two different seats";
  if (s.handSummary.targetState.folded || s.handSummary.blockedReason?.startsWith("The hand already ended")) {
    return "Someone folded";
  }
  if (!s.preflopClosed) return "Finish preflop first";
  if (s.handSummary.blockedReason) return `Finish the ${s.handSummary.targetStreet} first`;
  return null;
}

/** Why the board step can't move on yet; null once it can. */
export function boardBlocker(s: SolveSetup): string | null {
  if (s.boardLength < 3) return "Pick at least 3 cards";
  if (s.board.kind !== "ok") return "Fix the board";
  if (s.setupMode === "click" && s.handSummary.blockedReason) {
    return `Finish the ${s.handSummary.targetStreet} action first`;
  }
  return null;
}

/** Why the ranges step can't move on yet; null once it can. */
export function rangesBlocker(s: SolveSetup): string | null {
  const empty = [s.oopPosition, s.ipPosition].filter((p) => Object.keys(s.ranges[p] ?? {}).length === 0);
  return empty.length > 0 ? `Add hands to ${empty.join(" and ")}'s range` : null;
}

/** The first setup step that still needs something; Ready once none does.
 * Where a spot arriving from Ranges or the Library lands. */
export function firstOpenStep(s: SolveSetup): SolveStep {
  if (handBlocker(s)) return "hand";
  if (boardBlocker(s)) return "board";
  if (rangesBlocker(s)) return "ranges";
  return "ready";
}

/** Share of all 1,326 starting combos in a range, to one decimal: 39.4. */
export function rangePercent(range: HandRange): number {
  return Math.round((totalCombos(indexRange(range)) / 1326) * 1000) / 10;
}

/** Weighted combo count of a range, rounded: 522. */
export function rangeCombos(range: HandRange): number {
  return Math.round(totalCombos(indexRange(range)));
}

function isRaise(a: BuilderAction): boolean {
  return a.action === "raise" || a.action === "bet" || a.action === "all_in";
}

export interface RaiseNames {
  /** On the button: "3-bet…", "Raise…", "Bet…". */
  button: string;
  /** The sheet's title, after the player: "3-bets to…", "bets…". */
  title: string;
  /** The confirm button, before the size: "3-bet to", "Bet". */
  confirm: string;
}

/** What to call the aggressive action on this street: preflop it's named by
 * how many raises came before it (raise, 3-bet, 4-bet, 5-bet); after the flop
 * it's a bet or a raise. */
export function raiseNames(block: StreetBlock): RaiseNames {
  if (block.street !== "preflop") {
    return block.state.aggressiveLabel === "bet"
      ? { button: "Bet…", title: "bets…", confirm: "Bet" }
      : { button: "Raise…", title: "raises to…", confirm: "Raise to" };
  }
  const raises = block.actions.filter(isRaise).length;
  if (raises === 0) return { button: "Raise…", title: "raises to…", confirm: "Raise to" };
  const name = `${Math.min(raises + 2, 5)}-bet`;
  return { button: `${name}…`, title: `${name}s to…`, confirm: `${name} to` };
}

export interface SizePreset {
  /** The total this player will have put in this street ("raise to"). */
  toBb: number;
  /** "3× the raise", "75% of the pot". */
  sub: string;
}

/** What the player to act has put in this street, and the bet they face. */
export function wagerFacts(block: StreetBlock): { contributed: number; highest: number; maxTo: number } {
  const { state, ctx } = block;
  const contributed = ctx.stackBeforeBb - state.remainingBb[state.toAct];
  return { contributed, highest: contributed + state.toCallBb, maxTo: ctx.stackBeforeBb };
}

/** Round to a step like 0.5 or 0.1, without float residue (1.4, not 1.4000000000000001). */
function roundTo(n: number, step: number): number {
  const per = Math.round(1 / step);
  return Math.round(n * per) / per;
}

/**
 * The raise sheet's three presets (docs/mobile-redesign.md §4.1). Facing a
 * raise preflop: 3×, 3.5× and 4× it. Opening preflop (only the big blind to
 * beat): 2×, 2.5× and 3× the big blind, since 3× to 4× would be oversized
 * opens. After the flop: the solver's own menu, 25 / 75 / 125% of the pot,
 * as desktop offers. Sizes at or above the stack are left out (All-in covers
 * them).
 */
export function sizePresets(block: StreetBlock): SizePreset[] {
  const { highest, maxTo } = wagerFacts(block);
  let presets: SizePreset[];
  if (block.street === "preflop") {
    const opening = highest <= 1;
    const multiples = opening ? [2, 2.5, 3] : [3, 3.5, 4];
    presets = multiples.map((m) => ({
      toBb: roundTo(highest * m, 0.5),
      sub: `${m}× the ${opening ? "big blind" : "raise"}`,
    }));
  } else {
    const potIfCalled = block.state.potNowBb + block.state.toCallBb;
    presets = [0.25, 0.75, 1.25].map((f) => ({
      toBb: roundTo(highest + f * potIfCalled, 0.1),
      sub: `${f * 100}% of the pot`,
    }));
  }
  return presets.filter((p) => p.toBb > highest && p.toBb < maxTo);
}

/** "BTN raises to 2.5bb" split into the player and the rest, for bolding. */
export function splitAction(text: string, position: Position): [string, string] {
  return [position, text.slice(position.length + 1)];
}

const CARD_RE = /^([2-9TJQKA])([SHDC])$/i;

/**
 * The board step's "Or type it" box, read as you type: up to five cards,
 * accepted as soon as every token is a card and none repeats (so "Qs 5c"
 * fills two slots). Unlike lib/cards.ts's parseBoardText, fewer than three
 * is fine here, because the slots show the board being built.
 */
export function parseTypedCards(text: string): { kind: "ok"; cards: string[] } | { kind: "error"; reason: string } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 5) return { kind: "error", reason: "A board is at most 5 cards." };
  const cards: string[] = [];
  for (const token of tokens) {
    const match = CARD_RE.exec(token);
    if (!match) return { kind: "error", reason: `"${token}" isn't a card. Use rank and suit, like Kh.` };
    cards.push(match[1].toUpperCase() + match[2].toLowerCase());
  }
  if (new Set(cards).size !== cards.length) return { kind: "error", reason: "A card is repeated." };
  return { kind: "ok", cards };
}

/** "Solved in 18 seconds" (at least 1). */
export function solvedIn(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `Solved in ${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** "Very accurate: within 0.4% of the pot of perfect play." */
export function accuracyLine(solved: NonNullable<SolveSetup["lastSolved"]>): string {
  const { exploitability_pct: pct, converged } = solved.data;
  const { tier, title } = accuracyOf(pct, converged);
  if (converged === false) return "Rough: the server's time limit cut it short, so treat close percentages loosely.";
  if (pct === undefined) return `${title}.`;
  const name = tier === "rough" ? "Rough" : title;
  return `${name}: within ${pct.toFixed(1)}% of the pot of perfect play.`;
}
