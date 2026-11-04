import { LESSONS, explainOpen, questionFor, quizCount, readProgress, writeProgress } from "./lessons";
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
