import deckFile from "../data/drill-deck.json";
import { AGGRESSIVE, betAmount, formatBb, shuffled, type DrillAction, type DrillDeckFile, type DrillSpot } from "./drill";

// The "continuation bet" lesson's hands, taken from the Drill's pre-solved
// deck (BB vs BTN single-raised pots, 100bb): the spots where the BTN raised
// preflop, the BB called and then checked the flop. The answers are the
// solver's own frequencies for that exact hand, so regenerating the deck
// (apps/api/scripts/make_drill_deck.py) changes the hands but never makes the
// lesson wrong: the hands are picked from whatever the deck holds.

const deck = (deckFile as unknown as DrillDeckFile).decks.flatMap((d) => d.spots);

/** Share of the time the solver bets this hand (any size, all-in included). */
export function betFrequency(spot: DrillSpot): number {
  return spot.actions.filter((a) => AGGRESSIVE.has(a)).reduce((sum, a) => sum + (spot.mix[a] ?? 0), 0);
}

/** At or above this a hand is a clear bet; at or below 1 minus it, a clear check. */
export const CLEAR_MAJORITY = 0.6;

const SIZE_LABEL: Partial<Record<DrillAction, string>> = {
  bet_small: "a small bet (about a quarter of the pot)",
  bet_medium: "a medium bet (about three quarters of the pot)",
  bet_large: "a large bet (bigger than the pot)",
  all_in: "an all-in",
};

/** The bet size the solver uses most for this hand, in words. */
export function favoriteSize(spot: DrillSpot): string | null {
  let best: DrillAction | null = null;
  for (const a of spot.actions) {
    if (!AGGRESSIVE.has(a)) continue;
    if (best === null || (spot.mix[a] ?? 0) > (spot.mix[best] ?? 0)) best = a;
  }
  return best && (spot.mix[best] ?? 0) > 0 ? (SIZE_LABEL[best] ?? null) : null;
}

/** BTN in position, BB checked: the continuation-bet decision. */
export const CBET_CANDIDATES: DrillSpot[] = deck
  .filter((s) => s.situation === "facing_check" && s.heroPosition === "BTN")
  .sort((a, b) => a.id.localeCompare(b.id));

/**
 * Six hands, alternating clear bets and clear checks so neither answer is
 * always right. Seeded, so the lesson is the same every time. Fewer if the
 * deck doesn't hold three of each.
 */
export function pickCbetSpots(candidates: readonly DrillSpot[] = CBET_CANDIDATES): DrillSpot[] {
  const bets = shuffled(
    candidates.filter((s) => betFrequency(s) >= CLEAR_MAJORITY),
    7,
  ).slice(0, 3);
  const checks = shuffled(
    candidates.filter((s) => betFrequency(s) <= 1 - CLEAR_MAJORITY),
    7,
  ).slice(0, 3);
  const order: Array<"bet" | "check"> = ["bet", "check", "check", "bet", "bet", "check"];
  const out: DrillSpot[] = [];
  const queues = { bet: [...bets], check: [...checks] };
  for (const kind of order) {
    const next = queues[kind].shift();
    if (next) out.push(next);
  }
  return out;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** What the solver does with the hand and why, from its numbers. */
export function explainCbet(spot: DrillSpot): string {
  const bet = betFrequency(spot);
  const mix = `The solver bets this hand ${pct(bet)} of the time and checks it ${pct(1 - bet)}.`;
  const size = bet >= CLEAR_MAJORITY ? favoriteSize(spot) : null;
  const sizeText = size ? ` When it bets, it mostly uses ${size}.` : "";
  const bullets = spot.analysis?.bullets ?? [];
  // The hand and the reason; the middle bullet is about the whole range.
  const why = [bullets[0], bullets[2]].filter(Boolean).join(" ");
  return `${mix}${sizeText}${why ? ` ${why}` : ""}`;
}

// --- the other flop spots in the deck ---------------------------------------------------------------

/** What the solver does with a hand when it can fold, call or raise: the three shares. */
export function facingBetShares(spot: DrillSpot): { fold: number; call: number; raise: number } {
  return {
    fold: spot.mix.fold ?? 0,
    call: spot.mix.call ?? 0,
    raise: spot.actions.filter((a) => AGGRESSIVE.has(a)).reduce((sum, a) => sum + (spot.mix[a] ?? 0), 0),
  };
}

export type FacingAnswer = "fold" | "call" | "raise";

/** The answer the solver gives at least CLEAR_MAJORITY of the time, or null for a genuinely mixed hand. */
export function clearFacingAnswer(spot: DrillSpot): FacingAnswer | null {
  const shares = facingBetShares(spot);
  const best = (Object.keys(shares) as FacingAnswer[]).reduce((a, b) => (shares[b] > shares[a] ? b : a));
  return shares[best] >= CLEAR_MAJORITY ? best : null;
}

const BET_PCT: Partial<Record<DrillAction, number>> = { bet_small: 25, bet_medium: 75, bet_large: 125 };

/** "the BB bets 1.4bb (25% of the 5.5bb pot)". */
export function villainBetText(spot: DrillSpot): string {
  const pct = spot.facing ? BET_PCT[spot.facing] : undefined;
  return `the BB bets ${formatBb(betAmount(spot))}bb${pct ? ` (${pct}% of the ${spot.potBb}bb pot)` : ""}`;
}

/** The deck's spots of one kind for the hero's seat, in a fixed order. */
export function flopCandidates(situation: DrillSpot["situation"]): DrillSpot[] {
  return deck.filter((s) => s.situation === situation).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * `perAnswer` hands for each clear answer, mixed so neither is always right. Seeded: the same lesson every time.
 * `answerOf` gives a spot's clear answer, or null when it is mixed (those are left out on purpose: a hand the
 * solver splits near 50/50 has no one right answer to ask for).
 */
export function pickBy<A extends string>(
  candidates: readonly DrillSpot[],
  answerOf: (spot: DrillSpot) => A | null,
  plan: readonly A[],
  seed = 11,
): DrillSpot[] {
  const queues = new Map<A, DrillSpot[]>();
  for (const spot of shuffled(candidates, seed)) {
    const answer = answerOf(spot);
    if (answer) queues.set(answer, [...(queues.get(answer) ?? []), spot]);
  }
  const out: DrillSpot[] = [];
  for (const answer of plan) {
    const next = queues.get(answer)?.shift();
    if (next) out.push(next);
  }
  return out;
}

/** Why a facing-a-bet hand does what it does, in the solver's numbers. */
export function explainFacingBet(spot: DrillSpot): string {
  const s = facingBetShares(spot);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const mix = `With this hand the solver folds ${pct(s.fold)} of the time, calls ${pct(s.call)} and raises ${pct(s.raise)}.`;
  const size = s.raise >= CLEAR_MAJORITY ? favoriteSize(spot) : null;
  const sizeText = size ? ` When it raises, it mostly uses ${size}.` : "";
  const bullets = spot.analysis?.bullets ?? [];
  const why = [bullets[0], bullets[2]].filter(Boolean).join(" ");
  return `${mix}${sizeText}${why ? ` ${why}` : ""}`;
}
