import pairData from "../data/preflop-pairs.json";
import { CLEAR_MAJORITY, betFrequency, facingBetShares } from "./cbetLesson";
import { CONCEPT_LESSONS } from "./conceptLessons";
import { GENERATED_LESSONS } from "./generatedLessons";
import { GROUP_ORDER, LESSONS, questionFor, quizCount, type LessonStep } from "./lessons";
import { comboCount, inOpenRange, openHands, openPercent, type OpenSeat } from "./openRanges";
import { nodeFor } from "./practiceTable";

type Pair = { flat: string[]; threeBet: string[]; callVs3: string[]; fourBet: string[]; callVs4: string[] };
const PAIRS = pairData as Record<string, Pair>;
const pct = (hands: string[]) => Math.round((hands.reduce((s, h) => s + comboCount(h), 0) / 1326) * 100);

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const steps = (id: string) => lesson(id).steps;
const spots = (id: string) => steps(id).flatMap((s) => (s.kind === "spot" ? [s.spot] : []));

describe("the course", () => {
  it("has unique ids, every lesson in a known group, and groups in course order", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) expect(GROUP_ORDER).toContain(l.group);
    const order = LESSONS.map((l) => GROUP_ORDER.indexOf(l.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(LESSONS[0].id).toBe("positions"); // a new learner starts at the beginning
  });

  it("has a lesson per first-in seat, per defending seat, and for facing a 3-bet and a 4-bet", () => {
    for (const id of ["open-utg", "open-hj", "open-co", "open-btn", "open-sb", "defend-bb", "defend-sb", "defend-btn", "vs-3bet", "vs-4bet", "flop-oop", "flop-vs-bet", "squeeze", "tendencies"]) {
      expect(lesson(id), id).toBeDefined();
    }
  });

  it("every graded step of every lesson has exactly one right answer and an explanation for each choice", () => {
    for (const l of LESSONS) {
      expect(quizCount(l), l.id).toBeGreaterThanOrEqual(3);
      for (const s of l.steps) {
        const q = questionFor(s);
        if (!q) continue;
        expect(q.choices.filter((c) => c.correct), `${l.id}: ${q.prompt}`).toHaveLength(1);
        for (const c of q.choices) expect(c.why.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("generated lessons: the questions come from the data", () => {
  it("a question's right answer is the practice table's, for every spot step", () => {
    for (const l of GENERATED_LESSONS) {
      for (const s of l.steps) {
        if (s.kind !== "spot") continue;
        const node = nodeFor(s.spot);
        const q = questionFor(s)!;
        expect(q.choices.find((c) => c.correct)!.label, `${l.id} ${s.spot.hand}`).toBe(
          q.choices[node.options.indexOf(node.correct)].label,
        );
      }
    }
  });

  it("only asks about hands you could really hold at the spot, and never the same hand twice at a spot", () => {
    for (const l of GENERATED_LESSONS) {
      const seen = new Set<string>();
      for (const s of l.steps.flatMap((x) => (x.kind === "spot" ? [x.spot] : []))) {
        const key = `${s.kind}|${s.hero}|${s.opponent}|${s.hand}`;
        expect(seen.has(key), `${l.id} repeats ${key}`).toBe(false);
        seen.add(key);
        if (s.kind === "vs-3bet") expect(openHands(s.hero as OpenSeat)).toContain(s.hand); // you opened it
        if (s.kind === "vs-4bet") expect(PAIRS[`${s.opponent}>${s.hero}`].threeBet).toContain(s.hand); // you 3-bet it
      }
    }
  });

  it("opening lessons: right answers follow the seat's range, and a mix of raises and folds is asked", () => {
    for (const seat of ["UTG", "HJ", "CO", "BTN", "SB"] as OpenSeat[]) {
      const asked = spots(`open-${seat.toLowerCase()}`);
      expect(asked).toHaveLength(8);
      for (const s of asked) expect(nodeFor(s).correct).toBe(inOpenRange(seat, s.hand) ? "raise" : "fold");
      const raises = asked.filter((s) => inOpenRange(seat, s.hand)).length;
      expect(raises).toBeGreaterThanOrEqual(3);
      expect(raises).toBeLessThanOrEqual(5);
    }
  });

  it("the percentages in an opening lesson's first card are computed from the range", () => {
    for (const seat of ["UTG", "BTN"] as OpenSeat[]) {
      const intro = steps(`open-${seat.toLowerCase()}`)[0];
      expect(intro.kind === "read" && intro.body[0]).toContain(`about ${openPercent(seat)}% of hands`);
    }
  });

  it("the defending lessons quote each opener's numbers, worked out from the data", () => {
    const intro = steps("defend-bb")[0];
    const text = intro.kind === "read" ? intro.body.join(" ") : "";
    for (const opener of ["UTG", "HJ", "CO", "BTN", "SB"]) {
      const r = PAIRS[`${opener}>BB`];
      expect(text).toContain(`Against ${opener}: continue with about ${pct([...r.threeBet, ...r.flat])}% of hands (${pct(r.threeBet)}% 3-bet, ${pct(r.flat)}% call).`);
    }
  });

  it("each defending lesson asks all three answers, from the right seat against the right openers", () => {
    for (const [id, hero, openers] of [
      ["defend-bb", "BB", ["UTG", "HJ", "CO", "BTN", "SB"]],
      ["defend-sb", "SB", ["CO", "BTN"]],
      ["defend-btn", "BTN", ["HJ", "CO"]],
    ] as const) {
      const asked = spots(id);
      expect(new Set(asked.map((s) => s.hero))).toEqual(new Set([hero]));
      expect(new Set(asked.map((s) => s.opponent))).toEqual(new Set(openers));
      expect(new Set(asked.map((s) => nodeFor(s).correct))).toEqual(new Set(["raise", "call", "fold"]));
    }
  });

  it("the re-raise lessons ask the continue and the fold answers", () => {
    expect(new Set(spots("vs-3bet").map((s) => nodeFor(s).correct))).toEqual(new Set(["raise", "call", "fold"]));
    expect(new Set(spots("vs-4bet").map((s) => nodeFor(s).correct))).toEqual(new Set(["call", "fold"]));
  });

  it("is the same every time", async () => {
    const first = JSON.stringify(GENERATED_LESSONS);
    const { vi } = await import("vitest");
    vi.resetModules();
    const again = await import("./generatedLessons");
    expect(JSON.stringify(again.GENERATED_LESSONS)).toBe(first);
  });
});

describe("the flop lessons come from the solved deck", () => {
  const flopSteps = (id: string): Extract<LessonStep, { kind: "flop" }>[] =>
    steps(id).filter((s): s is Extract<LessonStep, { kind: "flop" }> => s.kind === "flop");

  it("only asks hands the solver plays one way at least 60% of the time", () => {
    for (const s of flopSteps("flop-oop")) {
      const bet = betFrequency(s.spot);
      expect(bet >= CLEAR_MAJORITY || bet <= 1 - CLEAR_MAJORITY).toBe(true);
      expect(s.spot.situation).toBe("first_to_act");
    }
    for (const s of flopSteps("flop-vs-bet")) {
      // Worked out here from the raw mix, not through the function that does the picking.
      const { fold, call, raise } = facingBetShares(s.spot);
      expect(Math.max(fold, call, raise)).toBeGreaterThanOrEqual(CLEAR_MAJORITY);
      expect(s.spot.situation).toBe("facing_bet");
    }
  });

  it("mixes answers so neither is always right, and gives each a size with its unit", () => {
    expect(new Set(flopSteps("flop-oop").map((s) => questionFor(s)!.choices.find((c) => c.correct)!.label)).size).toBe(2);
    expect(new Set(flopSteps("flop-vs-bet").map((s) => questionFor(s)!.choices.find((c) => c.correct)!.label)).size).toBeGreaterThanOrEqual(2);
    for (const s of flopSteps("flop-vs-bet")) expect(questionFor(s)!.prompt).toMatch(/the BB bets \d+(\.\d)?bb \(\d+% of the 5\.5bb pot\)/);
  });

  it("the explanation quotes the solver's own shares for the hand", () => {
    for (const s of flopSteps("flop-vs-bet")) {
      expect(questionFor(s)!.choices[0].why).toMatch(/the solver folds \d+% of the time, calls \d+% and raises \d+%/);
    }
  });
});

describe("the baseline is not the rule", () => {
  it("every generated lesson says its numbers are a baseline and points at the tendencies lesson", () => {
    const title = lesson("tendencies").title;
    expect(title).toBe("Playing against tendencies");
    for (const l of GENERATED_LESSONS) {
      const text = l.steps.flatMap((s) => (s.kind === "read" ? s.body : [])).join(" ");
      expect(text, l.id).toMatch(/baseline/i);
      expect(text, l.id).toContain(`"${title}"`);
    }
  });

  it("the hand-written lessons say they are principles, not solver output", () => {
    for (const l of CONCEPT_LESSONS) {
      const text = l.steps.flatMap((s) => (s.kind === "read" ? s.body : [])).join(" ");
      expect(text, l.id).toMatch(/isn't graded/i);
      expect(text, l.id).toMatch(/not solver output/i);
    }
  });

  it("the squeeze arithmetic is right", () => {
    expect(2.5 + 2.5 + 0.5 + 1).toBe(6.5);
    const q = steps("squeeze").find((s) => s.kind === "quiz" && /How much is in the pot/.test(s.prompt));
    expect(q && q.kind === "quiz" && q.choices.find((c) => c.correct)!.label).toBe("6.5bb");
  });
});
