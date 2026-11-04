// Turns a graded Drill answer into what the AI coach is given (the same grounded context the Train
// lessons use). The coach is only ever told what the solver and the Drill's own analysis computed
// (the mix, the equity, the range position); it words them, it doesn't work out any poker. See
// apps/api/app/coach.py.

import type { CoachContext } from "./api";
import {
  actionText,
  betAmount,
  formatBb,
  type BetDisplay,
  type DrillAction,
  type DrillSpot,
} from "./drill";

/** Shown when the coach can't answer and the app's own explanation is shown instead. Same words
 * as the Train lessons' coach (pages/TrainPage.tsx). */
export const COACH_FALLBACK_NOTE: Record<string, string> = {
  not_configured: "The AI coach isn't switched on yet, so this is the app's own explanation.",
  rate_limited: "You've asked a lot of questions this hour, so this is the app's own explanation. Try again later.",
  unavailable: "The AI coach couldn't be reached just now, so this is the app's own explanation.",
};

function situationText(spot: DrillSpot): string {
  const seat =
    spot.situation === "first_to_act"
      ? `You are ${spot.heroPosition}, out of position against ${spot.villainPosition}, and act first on the flop.`
      : spot.situation === "facing_check"
        ? `You are ${spot.heroPosition}, in position against ${spot.villainPosition}, who checked to you on the flop.`
        : `You are ${spot.heroPosition}, in position against ${spot.villainPosition}, who bet ${formatBb(betAmount(spot))}bb into you on the flop.`;
  return `${seat} Single-raised pot: ${formatBb(spot.potBb)}bb in the middle, ${formatBb(spot.stackBb)}bb effective stacks.`;
}

const ranked = (spot: DrillSpot): DrillAction[] =>
  [...spot.actions].sort((a, b) => (spot.mix[b] ?? 0) - (spot.mix[a] ?? 0));

export function drillCoachContext(
  spot: DrillSpot,
  chosen: DrillAction,
  betDisplay: BetDisplay,
): CoachContext {
  const label = (a: DrillAction) => actionText(spot, a, betDisplay);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const mix = ranked(spot)
    .map((a) => `${label(a)}: ${pct(spot.mix[a] ?? 0)}`)
    .join(", ");
  const analysis = spot.analysis;
  // What the learner reads if the AI can't answer: short. The hand, and the reason (the first and
  // third bullets); the mix is already on screen as bars, so it isn't repeated here.
  const short = analysis
    ? [analysis.bullets[0], analysis.bullets[2]].filter(Boolean).join(" ")
    : `The solver plays ${label(ranked(spot)[0])} most often here (${pct(spot.mix[ranked(spot)[0]] ?? 0)}).`;
  // Everything else goes to the model only.
  const details = [
    `The solver's mix for this exact hand: ${mix}.`,
    ...(analysis
      ? [
          ...analysis.bullets,
          `This hand has ${analysis.facts.equityPct}% equity against the opponent's range and beats ${analysis.facts.rangePercentile}% of the hands in its own range.`,
        ]
      : []),
  ];
  return {
    lesson_title: "Poker Drill",
    prompt: situationText(spot).slice(0, 400),
    board: spot.board,
    hand: [...spot.hand],
    picked: label(chosen).slice(0, 120),
    correct: `${label(ranked(spot)[0])} (the solver's most frequent action)`.slice(0, 120),
    explanation: short.slice(0, 1500),
    details: details.join(" ").slice(0, 1500),
  };
}

/**
 * Up to three questions worth tapping for this hand, each one the coach can answer from the data
 * it's given (the solver's mix and the computed facts). Don't add ones that need new solving.
 */
export function suggestedQuestions(
  spot: DrillSpot,
  chosen: DrillAction,
  betDisplay: BetDisplay,
): string[] {
  const order = ranked(spot);
  const out: string[] = [];
  if (chosen !== order[0]) {
    out.push(`Was ${actionText(spot, chosen, betDisplay)} really a mistake?`);
  }
  if (order.length > 1 && (spot.mix[order[1]] ?? 0) >= 0.1) {
    out.push("Why does the solver mix actions with this hand?");
  }
  if (spot.analysis) out.push("How does this hand do against their range?");
  out.push("Explain it like I'm new to poker.");
  return out.slice(0, 3);
}
