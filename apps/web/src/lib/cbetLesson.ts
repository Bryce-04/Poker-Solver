import deckFile from "../data/drill-deck.json";
import { AGGRESSIVE, shuffled, type DrillAction, type DrillDeckFile, type DrillSpot } from "./drill";

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
