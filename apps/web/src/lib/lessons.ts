// The Train tab's lessons (docs/decisions.md, 2026-11 Train tab). A lesson is
// plain data -- short reading cards and multiple-choice questions -- so adding
// one needs no new UI code. Progress is kept in this browser only for now.

import { betFrequency, CLEAR_MAJORITY, explainCbet, pickCbetSpots } from "./cbetLesson";
import type { DrillSpot } from "./drill";
import type { PracticeFilter } from "./practiceTable";
import { cardsFor as cardsForHand, earliestOpeningSeat, inOpenRange, openPercent, type OpenSeat } from "./openRanges";

export interface Choice {
  label: string;
  correct?: boolean;
  /** Shown after answering, whichever choice was picked. */
  why: string;
}

export type LessonStep =
  | { kind: "read"; title: string; body: string[] }
  | { kind: "quiz"; prompt: string; choices: Choice[] }
  /** "Folded to you in this seat with this hand: open or fold?" Graded against
   * the reference opening range (lib/openRanges.ts), so the answer and its
   * explanation are worked out, not written. */
  | { kind: "open"; seat: OpenSeat; hand: string }
  /** "The BB checks to you on this flop: bet or check?" Graded against the
   * Drill's pre-solved spots (lib/cbetLesson.ts): the answer is the solver's
   * own frequency for that exact hand. */
  | { kind: "cbet"; spot: DrillSpot };

/** What a graded step shows: the prompt, any cards, and the choices. */
export interface Question {
  prompt: string;
  cards?: [string, string];
  /** The flop, when the question is about one. */
  board?: string[];
  choices: Choice[];
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  minutes: number;
  /** The practice-table drill that goes with this lesson, offered when it ends. */
  practice?: PracticeFilter;
  steps: LessonStep[];
}

const opens = (seat: OpenSeat, hands: string[]): LessonStep[] => hands.map((hand) => ({ kind: "open", seat, hand }));

export const LESSONS: Lesson[] = [
  {
    id: "positions",
    title: "Positions and the button",
    summary: "Who acts when, and why sitting last is such an edge.",
    minutes: 4,
    steps: [
      {
        kind: "read",
        title: "Six seats, one button",
        body: [
          "At a 6-handed table the seats are named by where they sit relative to the dealer button: UTG, HJ (hijack), CO (cutoff), BTN (button), SB (small blind) and BB (big blind).",
          "The button moves one seat clockwise after every hand, so everyone gets each seat in turn.",
          'The small blind posts half a big blind and the big blind posts a full one before the cards are dealt. Those two seats are "in the blinds".',
        ],
      },
      {
        kind: "read",
        title: "Who acts first?",
        body: [
          "Before the flop, action starts with UTG (the seat left of the big blind) and goes around. The big blind acts last.",
          "After the flop the order flips: the small blind acts first, then the big blind, then UTG and so on, and the button acts last. Anyone who folded is skipped.",
          'Acting last is called being "in position"; acting first is "out of position".',
        ],
      },
      {
        kind: "read",
        title: "Why position is worth so much",
        body: [
          "Acting later means you see what your opponent does before you decide. A check tells you they are probably weak; a big bet tells you they probably are not.",
          "That information is worth real money over many hands. It's why good players open more hands from the button than from UTG, and why the blinds, who act first after the flop, are the hardest seats to play.",
        ],
      },
      {
        kind: "quiz",
        prompt: "The flop is dealt. The small blind and the button are still in the hand. Who acts first?",
        choices: [
          { label: "The small blind", correct: true, why: "After the flop the small blind acts first of the players still in; the button acts last." },
          { label: "The button", why: "The button acts last after the flop, which is why it's the best seat." },
          { label: "Whoever bet most before the flop", why: "Order never depends on the betting. After the flop it always starts with the first live seat after the button." },
        ],
      },
      {
        kind: "quiz",
        prompt: "Which seat acts first BEFORE the flop at a 6-handed table?",
        choices: [
          { label: "UTG, the seat left of the big blind", correct: true, why: "Preflop starts with the seat after the big blind (UTG) and ends with the big blind." },
          { label: "The small blind", why: "The small blind acts first only after the flop. Preflop it acts second to last." },
          { label: "The button", why: "The button is third to last to act preflop, just before the blinds." },
        ],
      },
      {
        kind: "quiz",
        prompt: "Why is the button the best seat?",
        choices: [
          { label: "It acts last after the flop, so it sees what everyone else does first", correct: true, why: "Information is the edge: acting last means every opponent has already shown their hand strength by checking or betting." },
          { label: "It pays no blind and so always wins chips", why: "Paying no blind helps, but the main edge is acting last on every later street." },
          { label: "It always gets the best cards", why: "Cards are random. The button's edge is position, not better cards." },
        ],
      },
    ],
  },
  {
    id: "pot-odds",
    title: "Pot odds and equity",
    summary: "Work out whether a call pays off, using a number instead of a feeling.",
    minutes: 6,
    steps: [
      {
        kind: "read",
        title: "Equity: your share of the pot",
        body: [
          "Your equity is how often your hand wins (counting ties as a share) if all the remaining cards are dealt out. A hand with 40% equity wins about 4 times in 10.",
          "You don't need to calculate it exactly. A useful shortcut: with a draw on the flop, multiply your outs (cards that complete it) by 4 to get a rough percentage of hitting by the river. A flush draw has 9 outs, so about 9 × 4 = 36%.",
        ],
      },
      {
        kind: "read",
        title: "Pot odds: the price you are being offered",
        body: [
          "When someone bets, the call amount and the size of the pot give you a price. The equity you need to break even is:",
          "call ÷ (pot after their bet + your call)",
          "Example: the pot is 10, they bet 10, so the pot is 20 and you must call 10 to win it. You need 10 ÷ (20 + 10) = 33% equity. If your hand wins more than that, calling makes money over time; less, and it loses.",
        ],
      },
      {
        kind: "quiz",
        prompt: "The pot is 20 and your opponent bets 10. What equity do you need to call?",
        choices: [
          { label: "25%", correct: true, why: "The pot becomes 30 and you pay 10: 10 ÷ (30 + 10) = 25%." },
          { label: "33%", why: "33% is the price of a pot-sized bet. A half-pot bet is cheaper: 10 ÷ (30 + 10) = 25%." },
          { label: "50%", why: "You'd need 50% only if the price were one to one. Here it's 10 ÷ 40 = 25%." },
        ],
      },
      {
        kind: "quiz",
        prompt: "You have a flush draw (9 outs) on the flop. Roughly how often does it complete by the river?",
        choices: [
          { label: "About 18%", why: "That's about one card to come (9 × 2). From the flop you see two more cards, so it's about double." },
          { label: "About 35%", correct: true, why: "With two cards to come, outs × 4 is the shortcut: 9 × 4 = 36%. The exact value is about 35%." },
          { label: "About 50%", why: "That's too high. A flush draw misses roughly two times in three by the river." },
        ],
      },
      {
        kind: "quiz",
        prompt: "The pot is 10, the opponent bets 10, and you hold a flush draw (about 35%). Is calling profitable on the draw alone?",
        choices: [
          { label: "Yes, narrowly", correct: true, why: "You need 33% and have about 35%, so a call is slightly profitable, before counting any extra money you win when you hit." },
          { label: "No, you need more than 50%", why: "Equity needed depends on the price. A pot-sized bet needs only 33%." },
          { label: "No, drawing hands should never call", why: "Draws often call when the price is right. That's what pot odds measure." },
        ],
      },
    ],
  },
  {
    id: "opening-hands",
    title: "Which hands to open",
    summary: "When it's folded to you, which hands are worth a raise from each seat.",
    minutes: 6,
    practice: "open",
    steps: [
      {
        kind: "read",
        title: "Open or fold",
        body: [
          "When everyone folds to you, you can raise to start the pot (an \"open\") or fold. Calling the big blind (\"limping\") is rarely right, so the choice is really raise or fold.",
          `You don't open every hand. A seat opens only the hands that win enough money over time, and that depends on who still has to act behind you. From UTG, five players act after you, so you open only about ${openPercent("UTG")}% of hands.`,
          "The ranges here are the app's reference charts for 100bb at a 6-handed table: approximate, built from standard opening principles rather than from one solver's output.",
        ],
      },
      ...opens("UTG", ["AQo", "T9s", "55", "KJo", "A5s"]),
      {
        kind: "read",
        title: "Later seats open wider",
        body: [
          `The closer you are to the button, the fewer players are left to act behind you, and the more hands you can open. The cutoff opens about ${openPercent("CO")}% of hands, and the button about ${openPercent("BTN")}%.`,
          "Notice that hands you just folded from UTG, like 55, KJo and A5s, become easy opens on the button. Same hand, different seat.",
        ],
      },
      ...opens("BTN", ["55", "KJo", "A5s", "Q8o", "72o"]),
    ],
  },
  {
    id: "continuation-bets",
    title: "The continuation bet",
    summary: "You raised before the flop and the big blind checked to you. When do you bet?",
    minutes: 6,
    steps: [
      {
        kind: "read",
        title: "What a continuation bet is",
        body: [
          'When you raised before the flop and a player called, you were the aggressor. If they check to you on the flop, a bet from you is called a "continuation bet" (c-bet): you keep betting as if you had the strongest hand.',
          "It works because the raiser usually does have the stronger range, and because the checker has to decide what to do with a hand they've already shown some weakness with.",
          "It is not automatic. Bet hands that are strong enough to want a call from worse, and hands that make good bluffs, and check the rest. These six are pre-solved, so the answer is how often the solver bets that exact hand on that exact flop.",
        ],
      },
      ...pickCbetSpots().map((spot): LessonStep => ({ kind: "cbet", spot })),
    ],
  },
];

/** The open-or-fold explanation, from the range data. */
export function explainOpen(seat: OpenSeat, hand: string): string {
  const pct = openPercent(seat);
  if (inOpenRange(seat, hand)) {
    return `${hand} is in the ${seat} opening range, so it's a raise. The ${seat} opens about ${pct}% of hands.`;
  }
  const first = earliestOpeningSeat(hand);
  const later = first ? ` It becomes an open from the ${first} onward, where the range is wider.` : " It's too weak to open from any seat.";
  return `${hand} is not in the ${seat} opening range, so it's a fold. The ${seat} opens only about ${pct}% of hands.${later}`;
}

/** The step as something to answer, or null for a reading card. */
export function questionFor(step: LessonStep): Question | null {
  if (step.kind === "quiz") return { prompt: step.prompt, choices: step.choices };
  if (step.kind === "cbet") {
    const bet = betFrequency(step.spot) >= CLEAR_MAJORITY;
    const why = explainCbet(step.spot);
    return {
      prompt: `You raised from the BTN and the BB called. The pot is ${step.spot.potBb}bb. The BB checks to you. Bet or check?`,
      cards: step.spot.hand,
      board: step.spot.board,
      choices: [
        { label: "Bet", correct: bet, why },
        { label: "Check", correct: !bet, why },
      ],
    };
  }
  if (step.kind !== "open") return null;
  const raise = inOpenRange(step.seat, step.hand);
  const why = explainOpen(step.seat, step.hand);
  return {
    prompt: `You're in the ${step.seat} at 100bb and everyone folds to you. Open or fold?`,
    cards: cardsForHand(step.hand),
    choices: [
      { label: "Raise to 2.5bb", correct: raise, why },
      { label: "Fold", correct: !raise, why },
    ],
  };
}

export interface LessonProgress {
  done: boolean;
  correct: number;
  total: number;
}

const KEY = "poker-solver.train.progress.v1";

export function readProgress(): Record<string, LessonProgress> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LessonProgress>) : {};
  } catch {
    return {};
  }
}

export function writeProgress(id: string, progress: LessonProgress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readProgress(), [id]: progress }));
  } catch {
    // Storage blocked or full: progress just isn't remembered.
  }
}

/** Below this share right, a finished lesson is worth another go. */
export const REVISIT_BELOW = 0.8;

export type Recommendation =
  | { kind: "start"; lessonId: string; message: string }
  | { kind: "revisit"; lessonId: string; message: string }
  | { kind: "finished"; message: string };

/**
 * What to do next, from progress alone. Deliberately plain rules, not a
 * model: the first lesson you haven't finished, else the weakest finished one
 * under REVISIT_BELOW, else you're done and the Drill is the next thing.
 * Picking from the fixed course can't invent a lesson or a score.
 */
export function recommendNext(
  progress: Record<string, LessonProgress>,
  lessons: readonly Lesson[] = LESSONS,
): Recommendation {
  const first = lessons.find((l) => !progress[l.id]?.done);
  if (first) {
    const any = lessons.some((l) => progress[l.id]?.done);
    return {
      kind: "start",
      lessonId: first.id,
      message: any ? `Next lesson: ${first.title}.` : `Start with ${first.title}.`,
    };
  }
  let weakest: { lesson: Lesson; share: number; p: LessonProgress } | null = null;
  for (const lesson of lessons) {
    const p = progress[lesson.id];
    const share = p.total === 0 ? 1 : p.correct / p.total;
    if (share < REVISIT_BELOW && (weakest === null || share < weakest.share)) weakest = { lesson, share, p };
  }
  if (weakest) {
    return {
      kind: "revisit",
      lessonId: weakest.lesson.id,
      message: `Worth another go: ${weakest.lesson.title}. You got ${weakest.p.correct} of ${weakest.p.total} right.`,
    };
  }
  return { kind: "finished", message: "You've finished every lesson. Test yourself in the Drill." };
}

export const quizCount = (lesson: Lesson): number => lesson.steps.filter((s) => s.kind !== "read").length;
