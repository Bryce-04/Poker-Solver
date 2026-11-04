import { computeStreetState, preflopContext, type BuilderAction } from "../../../lib/handBuilder";
import type { StreetBlock } from "../solveText";
import type { SolveSetup } from "../useSolveSetup";
import {
  accuracyLine,
  parseTypedCards,
  raiseNames,
  readStep,
  sizePresets,
  solvedIn,
  wagerFacts,
} from "./phoneSteps";

function preflopBlock(actions: BuilderAction[], stack = 100): StreetBlock {
  const ctx = preflopContext("BB", "BTN", stack);
  return { street: "preflop", ctx, actions, state: computeStreetState(ctx, actions) };
}

function flopBlock(actions: BuilderAction[]): StreetBlock {
  const ctx = { oopPosition: "BB", ipPosition: "BTN", potBeforeBb: 5.5, stackBeforeBb: 97.5, firstToAct: "BB" } as const;
  return { street: "flop", ctx, actions, state: computeStreetState(ctx, actions) };
}

const OPEN: BuilderAction = { position: "BTN", action: "raise", toBb: 2.5 };
const THREE_BET: BuilderAction = { position: "BB", action: "raise", toBb: 9 };

describe("raiseNames", () => {
  it("names preflop raises by how many came before", () => {
    expect(raiseNames(preflopBlock([])).button).toBe("Raise…");
    expect(raiseNames(preflopBlock([OPEN]))).toEqual({ button: "3-bet…", title: "3-bets to…", confirm: "3-bet to" });
    expect(raiseNames(preflopBlock([OPEN, THREE_BET])).button).toBe("4-bet…");
  });

  it("is a bet or a raise after the flop", () => {
    expect(raiseNames(flopBlock([])).confirm).toBe("Bet");
    expect(raiseNames(flopBlock([{ position: "BB", action: "bet", toBb: 4 }])).confirm).toBe("Raise to");
  });
});

describe("sizePresets", () => {
  it("opens at 2, 2.5 and 3 big blinds", () => {
    expect(sizePresets(preflopBlock([])).map((p) => p.toBb)).toEqual([2, 2.5, 3]);
  });

  it("3-bets at 3×, 3.5× and 4× the raise, rounded to half a big blind", () => {
    expect(sizePresets(preflopBlock([OPEN]))).toEqual([
      { toBb: 7.5, sub: "3× the raise" },
      { toBb: 9, sub: "3.5× the raise" },
      { toBb: 10, sub: "4× the raise" },
    ]);
  });

  it("leaves out sizes at or above the stack", () => {
    expect(sizePresets(preflopBlock([OPEN], 9)).map((p) => p.toBb)).toEqual([7.5]);
  });

  it("bets 25, 75 and 125% of the pot after the flop", () => {
    expect(sizePresets(flopBlock([])).map((p) => p.toBb)).toEqual([1.4, 4.1, 6.9]);
  });

  it("knows what the player to act faces", () => {
    expect(wagerFacts(preflopBlock([OPEN]))).toEqual({ contributed: 1, highest: 2.5, maxTo: 100 });
  });
});

describe("parseTypedCards", () => {
  it("accepts a partial board as it's typed", () => {
    expect(parseTypedCards("qs 5C")).toEqual({ kind: "ok", cards: ["Qs", "5c"] });
    expect(parseTypedCards("")).toEqual({ kind: "ok", cards: [] });
  });

  it("refuses a non-card, a repeat, or more than five", () => {
    expect(parseTypedCards("Qs 5x").kind).toBe("error");
    expect(parseTypedCards("Qs qs").kind).toBe("error");
    expect(parseTypedCards("2c 3c 4c 5c 6c 7c").kind).toBe("error");
  });
});

describe("readStep", () => {
  it("reads a known step and nothing else", () => {
    expect(readStep("board")).toBe("board");
    expect(readStep("nope")).toBeNull();
    expect(readStep(null)).toBeNull();
  });
});

describe("solve wording", () => {
  const solved = (data: Record<string, unknown>) =>
    ({ data: { exploitability_pct: 0.44, converged: true, ...data } }) as unknown as NonNullable<SolveSetup["lastSolved"]>;

  it("says how long a solve took", () => {
    expect(solvedIn(400)).toBe("Solved in 1 second");
    expect(solvedIn(18_200)).toBe("Solved in 18 seconds");
  });

  it("says how accurate it is, with desktop's thresholds", () => {
    expect(accuracyLine(solved({}))).toBe("Very accurate: within 0.4% of the pot of perfect play.");
    expect(accuracyLine(solved({ exploitability_pct: 1.2 }))).toBe("Accurate: within 1.2% of the pot of perfect play.");
    expect(accuracyLine(solved({ exploitability_pct: 2 }))).toBe("Rough: within 2.0% of the pot of perfect play.");
    expect(accuracyLine(solved({ converged: false }))).toMatch(/time limit cut it short/);
  });
});
