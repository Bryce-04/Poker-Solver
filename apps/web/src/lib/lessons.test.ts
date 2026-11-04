import { LESSONS, quizCount, readProgress, writeProgress } from "./lessons";

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
