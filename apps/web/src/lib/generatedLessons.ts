import { HAND_GRID } from "./hands";
import { comboCount, openHands, openPercent, type OpenSeat } from "./openRanges";
import {
  PAIR_KEYS,
  mulberry32,
  nodeFor,
  pairFor,
  type Action,
  type PairRanges,
  type Rng,
  type Seat,
  type SpotRef,
} from "./practiceTable";
import type { Lesson, LessonStep } from "./lessons";
import { seatPhrase } from "./seats";
import { betFrequency, CLEAR_MAJORITY, clearFacingAnswer, flopCandidates, pickBy } from "./cbetLesson";

// Lessons built from the range data, so the questions, the right answers and the percentages
// quoted are worked out, never typed, and always agree with the practice table (both grade
// through practiceTable.nodeFor). What is written by hand here is the framing only. Each lesson
// is seeded by its id, so it is the same every time.
//
// The ranges are the app's approximate reference charts: a *baseline* against a balanced
// opponent, not a rule. Every lesson says so and points at "Playing against tendencies".

const ALL_HANDS: readonly string[] = HAND_GRID.flat();
const TOTAL = 1326;

const pct = (hands: readonly string[]): number => Math.round((hands.reduce((s, h) => s + comboCount(h), 0) / TOTAL) * 100);

function seedFrom(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** A seeded sample of n items (fewer if there aren't n). */
function sample<T>(items: readonly T[], n: number, rng: Rng): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

const BASELINE_NOTE =
  "These are baseline ranges, for a balanced opponent. Against a real player who opens too wide, folds too much or calls too often, the best play shifts: see \"Playing against tendencies\".";

/** For one spot, which hands have which right answer. */
function pools(ref: Omit<SpotRef, "hand">, universe: readonly string[]): Record<Action, string[]> {
  const out: Record<Action, string[]> = { fold: [], call: [], raise: [] };
  for (const hand of universe) out[nodeFor({ ...ref, hand }).correct].push(hand);
  return out;
}

/** Narrows to the preferred hands when enough of them exist, else keeps everything. */
function prefer(candidates: string[], favoured: ReadonlySet<string> | undefined, needed: number): string[] {
  if (!favoured) return candidates;
  const narrowed = candidates.filter((h) => favoured.has(h));
  return narrowed.length >= needed ? narrowed : candidates;
}

interface Ask {
  ref: Omit<SpotRef, "hand">;
  want: Action;
  universe: readonly string[];
  /** Hands to prefer for each answer: the edge of a range, the near misses, rather than the obvious ones. */
  favour?: Partial<Record<Action, ReadonlySet<string>>>;
}

/** Turns a list of "ask this spot, wanting that answer" into question steps, never repeating a hand at a spot. */
function questions(asks: Ask[], rng: Rng): LessonStep[] {
  const used = new Set<string>();
  const steps: LessonStep[] = [];
  for (const ask of asks) {
    const p = pools(ask.ref, ask.universe);
    const order: Action[] = [ask.want, ...(["raise", "call", "fold"] as Action[]).filter((a) => a !== ask.want)];
    const key = `${ask.ref.kind}|${ask.ref.hero}|${ask.ref.opponent}`;
    for (const action of order) {
      const candidates = prefer(
        p[action].filter((h) => !used.has(`${key}|${h}`)),
        ask.favour?.[action],
        3,
      );
      if (candidates.length === 0) continue;
      const [hand] = sample(candidates, 1, rng);
      used.add(`${key}|${hand}`);
      steps.push({ kind: "spot", spot: { ...ask.ref, hand } });
      break;
    }
  }
  return steps;
}

// --- opening ---------------------------------------------------------------------------------------

/** First-in seats, tightest to loosest range. */
const OPEN_ORDER: OpenSeat[] = ["UTG", "HJ", "CO", "SB", "BTN"];

const SEAT_NAME: Record<OpenSeat, { title: string; the: string }> = {
  UTG: { title: "Opening from under the gun", the: "under the gun" },
  HJ: { title: "Opening from the hijack", the: "the hijack" },
  CO: { title: "Opening from the cutoff", the: "the cutoff" },
  BTN: { title: "Opening from the button", the: "the button" },
  SB: { title: "Opening from the small blind", the: "the small blind" },
};

function openLesson(seat: OpenSeat): Lesson {
  const id = `open-${seat.toLowerCase()}`;
  const rng = mulberry32(seedFrom(id));
  const at = OPEN_ORDER.indexOf(seat);
  const tighter = at > 0 ? OPEN_ORDER[at - 1] : null;
  const looser = at < OPEN_ORDER.length - 1 ? OPEN_ORDER[at + 1] : null;
  const mine = new Set(openHands(seat));
  const tighterSet = new Set(tighter ? openHands(tighter) : []);
  const edgeIn = new Set(tighter ? [...mine].filter((h) => !tighterSet.has(h)) : []);
  const edgeOut = new Set(looser ? openHands(looser).filter((h) => !mine.has(h)) : []);

  const wants: Action[] = ["raise", "fold", "fold", "raise", "raise", "fold", "fold", "raise"];
  const asks: Ask[] = wants.map((want) => ({
    ref: { kind: "open", hero: seat, opponent: null },
    want,
    universe: ALL_HANDS,
    favour: { raise: edgeIn, fold: edgeOut },
  }));
  const steps = questions(asks, rng);

  const body = [
    `${SEAT_NAME[seat].the[0].toUpperCase()}${SEAT_NAME[seat].the.slice(1)} opens about ${openPercent(seat)}% of hands (${mine.size} of 169 hand types). ${
      tighter && looser
        ? `That is wider than ${tighter} and tighter than ${looser}: the questions are mostly about the edge, hands that just make it and hands that just miss.`
        : tighter
          ? `That is the widest of the first-in ranges, so most of the questions are about which hands still don't make it.`
          : `That is the tightest of the first-in ranges, because every other player is still to act.`
    }`,
    `Open means raise to 2.5bb. Anything not in the range is a fold.`,
    BASELINE_NOTE,
  ];
  return {
    id,
    group: "Opening",
    title: SEAT_NAME[seat].title,
    summary: `Which hands ${seat} opens, with the close calls.`,
    minutes: 5,
    practice: "open",
    steps: [{ kind: "read", title: `${seat}: the opening range`, body }, ...steps],
  };
}

// --- defending -------------------------------------------------------------------------------------

const CONTINUING = (r: PairRanges): string[] => [...r.threeBet, ...r.flat];

function defendLesson(defender: Seat, title: string, summary: string, perPair: number): Lesson {
  const id = `defend-${defender.toLowerCase()}`;
  const rng = mulberry32(seedFrom(id));
  const pairs = PAIR_KEYS.filter(([, d]) => d === defender);
  // Hands that are a continue against some other opener but a fold here: the realistic near misses.
  const widest = new Set(pairs.flatMap(([o, d]) => CONTINUING(pairFor(o, d) as PairRanges)));

  const cycle: Action[] = ["raise", "call", "fold"];
  const asks: Ask[] = [];
  let n = 0;
  for (const [opener] of pairs) {
    for (let i = 0; i < perPair; i++) {
      asks.push({
        ref: { kind: "vs-open", hero: defender, opponent: opener },
        want: cycle[n++ % cycle.length],
        universe: ALL_HANDS,
        favour: { fold: widest },
      });
    }
  }
  const lines = pairs.map(([o, d]) => {
    const r = pairFor(o, d) as PairRanges;
    return `Against ${o}: continue with about ${pct(CONTINUING(r))}% of hands (${pct(r.threeBet)}% 3-bet, ${pct(r.flat)}% call).`;
  });
  return {
    id,
    group: "Defending",
    title,
    summary,
    minutes: 6,
    practice: "defend",
    steps: [
      {
        kind: "read",
        title: "Fold, call or 3-bet",
        body: [
          `When someone opens and it's your turn ${seatPhrase(defender)}, you choose between folding, calling and 3-betting. The right mix depends on who opened: the earlier their seat, the stronger their range, so the tighter you defend.`,
          ...lines,
          BASELINE_NOTE,
        ],
      },
      ...questions(asks, rng),
    ],
  };
}

// --- facing re-raises ------------------------------------------------------------------------------

function against3betLesson(): Lesson {
  const id = "vs-3bet";
  const rng = mulberry32(seedFrom(id));
  const pairs = sample(PAIR_KEYS, PAIR_KEYS.length, rng);
  const cycle: Action[] = ["raise", "call", "fold", "call", "fold", "raise", "call", "fold", "raise", "call"];
  const asks: Ask[] = pairs.slice(0, 9).concat(pairs.slice(0, 1)).map(([opener, defender], i) => ({
    ref: { kind: "vs-3bet", hero: opener, opponent: defender },
    want: cycle[i % cycle.length],
    // Facing a 3-bet you can only hold a hand you opened with.
    universe: openHands(opener as OpenSeat),
  }));
  return {
    id,
    group: "Against re-raises",
    title: "Facing a 3-bet",
    summary: "You opened and someone re-raised: fold, call or 4-bet.",
    minutes: 6,
    practice: "all",
    steps: [
      {
        kind: "read",
        title: "You opened, they 3-bet",
        body: [
          "You raised, and a player behind you re-raised (a 3-bet) to 9bb. You only ever hold a hand you opened with, so the question is which of those continue: your strongest hands 4-bet, a middle group calls, and the rest fold.",
          "Folding a hand that was fine to open is correct here. Opening a hand and then folding to a 3-bet is part of how the range works, not a mistake.",
          BASELINE_NOTE,
        ],
      },
      ...questions(asks, rng),
    ],
  };
}

function against4betLesson(): Lesson {
  const id = "vs-4bet";
  const rng = mulberry32(seedFrom(id));
  const pairs = sample(PAIR_KEYS, PAIR_KEYS.length, rng);
  const asks: Ask[] = pairs.slice(0, 8).map(([opener, defender], i) => ({
    ref: { kind: "vs-4bet", hero: defender, opponent: opener },
    want: i % 2 === 0 ? "call" : "fold",
    // Facing a 4-bet you can only hold a hand you 3-bet with.
    universe: pairFor(opener, defender)?.threeBet ?? [],
  }));
  return {
    id,
    group: "Against re-raises",
    title: "Facing a 4-bet",
    summary: "You 3-bet and the opener 4-bet: continue or fold.",
    minutes: 5,
    practice: "all",
    steps: [
      {
        kind: "read",
        title: "You 3-bet, they 4-bet",
        body: [
          "You 3-bet and the opener re-raised to 22bb (a 4-bet). Now the pot is big and the price is high, so only part of your 3-betting range continues. The hands here are all ones you 3-bet with.",
          "Hands that were fine as 3-bet bluffs usually fold to a 4-bet. The best hands continue.",
          BASELINE_NOTE,
        ],
      },
      ...questions(asks, rng),
    ],
  };
}

// --- flops, from the Drill's solved deck -----------------------------------------------------------

const FLOP_NOTE =
  "These frequencies are the solver's baseline against a balanced opponent. Against a real player the best play shifts: someone who rarely folds should be bet harder with your good hands and bluffed less, and someone who folds too much should be bluffed more. See \"Playing against tendencies\".";

function flopOutOfPositionLesson(): Lesson {
  const spots = pickBy(
    flopCandidates("first_to_act"),
    (s) => (betFrequency(s) >= CLEAR_MAJORITY ? "bet" : betFrequency(s) <= 1 - CLEAR_MAJORITY ? "check" : null),
    ["bet", "check", "bet", "check", "bet", "check"],
  );
  return {
    id: "flop-oop",
    group: "After the flop",
    title: "Out of position on the flop",
    summary: "You called from the big blind and act first: check or bet?",
    minutes: 6,
    steps: [
      {
        kind: "read",
        title: "Acting first",
        body: [
          "You called a button raise from the big blind, so after the flop you act first with no information. The solver mixes a lot here: many hands bet, but a good share check, because checking protects the hands you'd like to keep in the pot cheaply.",
          "These six hands are ones the solver plays one way at least 60% of the time; the closely mixed hands are left out. The answer is how the solver plays that exact hand on that exact flop.",
          FLOP_NOTE,
        ],
      },
      ...spots.map((spot): LessonStep => ({ kind: "flop", spot })),
    ],
  };
}

function flopFacingBetLesson(): Lesson {
  const spots = pickBy(flopCandidates("facing_bet"), clearFacingAnswer, ["raise", "call", "fold", "call", "raise", "fold"]);
  return {
    id: "flop-vs-bet",
    group: "After the flop",
    title: "Facing a bet on the flop",
    summary: "You raised, they called and then bet: fold, call or raise?",
    minutes: 6,
    steps: [
      {
        kind: "read",
        title: "Facing a bet",
        body: [
          "You raised from the button and the big blind called, then bet into you on the flop. You act last, so you can fold, call or raise. With the small bets the solver plays here, it calls or raises a lot and folds only the weakest hands.",
          "These are hands the solver plays one way at least 60% of the time. The explanation quotes its folding, calling and raising shares for that exact hand.",
          FLOP_NOTE,
        ],
      },
      ...spots.map((spot): LessonStep => ({ kind: "flop", spot })),
    ],
  };
}

export const GENERATED_LESSONS: Lesson[] = [
  ...(["UTG", "HJ", "CO", "BTN", "SB"] as OpenSeat[]).map(openLesson),
  defendLesson("BB", "Defending the big blind", "You're already in for 1bb: when to fold, call and 3-bet against each open.", 2),
  defendLesson("SB", "Defending the small blind", "Out of position and with a worse price: who you can fight back against.", 3),
  defendLesson("BTN", "Defending on the button", "You act last, so you can call more: what to 3-bet and what to flat.", 3),
  against3betLesson(),
  against4betLesson(),
  flopOutOfPositionLesson(),
  flopFacingBetLesson(),
];

