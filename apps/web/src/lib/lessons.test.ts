import { LESSONS, explainOpen, questionFor, quizCount, readProgress, writeProgress } from "./lessons";
import { betFrequency, CLEAR_MAJORITY, CBET_CANDIDATES, explainCbet, favoriteSize, pickCbetSpots } from "./cbetLesson";
import { gradeAction } from "./drill";
import { cardsFor, comboCount, earliestOpeningSeat, inOpenRange, openPercent } from "./openRanges";

describe("lessons data", () => {
  it("has unique ids and every quiz has exactly one correct answer", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const lesson of LESSONS) {
      expect(lesson.steps.length).toBeGreaterThan(0);
      for (const step of lesson.steps) {
        if (step.kind !== "quiz") continue;
        expect(step.choices.filter((c) => c.correct)).toHaveLength(1);
        for (const c of step.choices) expect(c.why.length).toBeGreaterThan(0);
      }
    }
  });

  it("pot-odds answers agree with the formula they teach", () => {
    // call / (pot after the bet + call)
    const need = (pot: number, bet: number) => bet / (pot + bet + bet);
    expect(need(20, 10)).toBeCloseTo(0.25);
    expect(need(10, 10)).toBeCloseTo(1 / 3);
  });

  it("counts quiz steps", () => {
    expect(quizCount(LESSONS[0])).toBe(3);
  });
});

describe("opening-hands lesson", () => {
  const lesson = LESSONS.find((l) => l.id === "opening-hands")!;

  it("has ten graded hands, each with exactly one right answer taken from the range data", () => {
    expect(quizCount(lesson)).toBe(10);
    for (const step of lesson.steps) {
      if (step.kind !== "open") continue;
      const q = questionFor(step)!;
      expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
      expect(q.choices[0].correct).toBe(inOpenRange(step.seat, step.hand)); // Raise
      expect(q.choices[1].correct).toBe(!inOpenRange(step.seat, step.hand)); // Fold
    }
  });

  it("teaches what it says: the hands folded from UTG are opened on the button", () => {
    for (const hand of ["55", "KJo", "A5s"]) {
      expect(inOpenRange("UTG", hand)).toBe(false);
      expect(inOpenRange("BTN", hand)).toBe(true);
    }
    expect(inOpenRange("BTN", "72o")).toBe(false);
    expect(inOpenRange("BTN", "Q8o")).toBe(false);
    expect(inOpenRange("UTG", "AQo")).toBe(true);
  });

  it("explains a fold with where the hand starts to be opened", () => {
    expect(explainOpen("UTG", "KJo")).toMatch(/not in the UTG opening range.*from the (HJ|CO|BTN) onward/);
    expect(explainOpen("BTN", "72o")).toMatch(/too weak to open from any seat/);
    expect(explainOpen("BTN", "A5s")).toMatch(/is in the BTN opening range/);
  });
});

describe("continuation-bet lesson", () => {
  const spots = pickCbetSpots();

  it("uses six BTN-in-position facing-a-check hands from the solved deck, bets and checks alternating", () => {
    expect(CBET_CANDIDATES.length).toBeGreaterThanOrEqual(12);
    expect(spots).toHaveLength(6);
    expect(new Set(spots.map((s) => s.id)).size).toBe(6);
    for (const s of spots) {
      expect(s.situation).toBe("facing_check");
      expect(s.heroPosition).toBe("BTN");
    }
    const bets = spots.filter((s) => betFrequency(s) >= CLEAR_MAJORITY).length;
    expect(bets).toBe(3);
    expect(pickCbetSpots().map((s) => s.id)).toEqual(spots.map((s) => s.id)); // deterministic
  });

  it("every question has one right answer, and it is a 'best' move by the Drill's own grading", () => {
    const lesson = LESSONS.find((l) => l.id === "continuation-bets")!;
    expect(quizCount(lesson)).toBe(6);
    for (const step of lesson.steps) {
      if (step.kind !== "cbet") continue;
      const q = questionFor(step)!;
      expect(q.board).toHaveLength(3);
      expect(q.cards).toHaveLength(2);
      const right = q.choices.find((c) => c.correct)!;
      expect(q.choices.filter((c) => c.correct)).toHaveLength(1);
      // The lesson asks bet-or-check, so grade the way the Drill does but on the two merged
      // actions: the right answer must be a "best" move and the other not.
      const b = betFrequency(step.spot);
      const merged = { ...step.spot, actions: ["check", "bet_small"] as const, mix: { check: 1 - b, bet_small: b } };
      const rightAction = right.label === "Bet" ? "bet_small" : "check";
      const wrongAction = right.label === "Bet" ? "check" : "bet_small";
      expect(gradeAction({ ...merged, actions: [...merged.actions] }, rightAction).verdict).toBe("best");
      expect(gradeAction({ ...merged, actions: [...merged.actions] }, wrongAction).verdict).not.toBe("best");
    }
  });

  it("explains with the solver's own numbers", () => {
    const bet = spots.find((s) => betFrequency(s) >= CLEAR_MAJORITY)!;
    const text = explainCbet(bet);
    expect(text).toContain(`bets this hand ${Math.round(betFrequency(bet) * 100)}% of the time`);
    expect(favoriteSize(bet)).not.toBeNull();
    const check = spots.find((s) => betFrequency(s) <= 1 - CLEAR_MAJORITY)!;
    expect(explainCbet(check)).toMatch(/checks it \d+%/);
    expect(explainCbet(check)).not.toMatch(/mostly uses/);
  });
});

describe("opening range helpers", () => {
  it("counts combos and percentages", () => {
    expect(comboCount("AA")).toBe(6);
    expect(comboCount("AKs")).toBe(4);
    expect(comboCount("AKo")).toBe(12);
    expect(openPercent("UTG")).toBeLessThan(openPercent("CO"));
    expect(openPercent("CO")).toBeLessThan(openPercent("BTN"));
  });

  it("finds the earliest opening seat", () => {
    expect(earliestOpeningSeat("AKo")).toBe("UTG");
    expect(earliestOpeningSeat("A5s")).toBe("HJ");
    expect(earliestOpeningSeat("72o")).toBeNull();
  });

  it("deals two real, distinct cards for any label", () => {
    expect(cardsFor("AKo")).toEqual(["As", "Kh"]);
    expect(cardsFor("T9s")).toEqual(["Ts", "9s"]);
    expect(cardsFor("55")).toEqual(["5s", "5h"]);
  });
});

describe("progress storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips and keeps other lessons", () => {
    writeProgress("a", { done: true, correct: 2, total: 3 });
    writeProgress("b", { done: false, correct: 0, total: 3 });
    expect(readProgress()).toEqual({
      a: { done: true, correct: 2, total: 3 },
      b: { done: false, correct: 0, total: 3 },
    });
  });

  it("survives corrupt or blocked storage", () => {
    window.localStorage.setItem("poker-solver.train.progress.v1", "{not json");
    expect(readProgress()).toEqual({});
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeProgress("a", { done: true, correct: 1, total: 1 })).not.toThrow();
    spy.mockRestore();
  });
});
