import { describe, expect, it } from "vitest";
import {
  actionAmountBb,
  actionParts,
  actionText,
  aggressiveActions,
  betAmount,
  formatBb,
  gradeAction,
  passiveActions,
  shuffled,
  type DrillSpot,
} from "./drill";

function spot(overrides: Partial<DrillSpot>): DrillSpot {
  return {
    id: "t",
    board: ["Ks", "7h", "2d"],
    heroPosition: "BB",
    villainPosition: "BTN",
    situation: "first_to_act",
    potBb: 5.5,
    stackBb: 97.5,
    hand: ["Ah", "Kh"],
    actions: ["check", "bet_small", "bet_medium", "bet_large", "all_in"],
    mix: { check: 0.5, bet_small: 0.3, bet_medium: 0.15, bet_large: 0.05, all_in: 0 },
    ...overrides,
  };
}

describe("gradeAction", () => {
  it("calls a frequent action best", () => {
    expect(gradeAction(spot({}), "check")).toMatchObject({ verdict: "best", points: 1 });
  });

  it("gives half credit to a real but smaller frequency", () => {
    expect(gradeAction(spot({}), "bet_small")).toMatchObject({ verdict: "good", points: 0.5 });
  });

  it("marks an action the solver rarely plays a miss", () => {
    const g = gradeAction(spot({}), "bet_large");
    expect(g).toMatchObject({ verdict: "miss", points: 0, topAction: "check" });
  });

  it("counts the top action as best even when the mix is flat", () => {
    const flat = spot({
      mix: { check: 0.34, bet_small: 0.33, bet_medium: 0.33, bet_large: 0, all_in: 0 },
    });
    expect(gradeAction(flat, "check").verdict).toBe("best");
  });

  it("treats an action absent from the mix as a miss", () => {
    expect(gradeAction(spot({ mix: { check: 1 } }), "all_in").verdict).toBe("miss");
  });
});

const facingSmall = (overrides: Partial<DrillSpot> = {}) =>
  spot({
    situation: "facing_bet",
    facing: "bet_small",
    actions: ["fold", "call", "bet_small", "bet_medium", "bet_large", "all_in"],
    ...overrides,
  });

describe("passiveActions / aggressiveActions", () => {
  it("splits the legal actions into passive and bet/raise sizes", () => {
    expect(passiveActions(spot({}))).toEqual(["check"]);
    expect(aggressiveActions(spot({}))).toEqual(["bet_small", "bet_medium", "bet_large", "all_in"]);
    expect(passiveActions(facingSmall())).toEqual(["fold", "call"]);
  });
});

describe("actionAmountBb", () => {
  it("sizes a bet as a fraction of the pot", () => {
    expect(actionAmountBb(spot({}), "bet_small")).toBeCloseTo(1.375);
    expect(actionAmountBb(spot({}), "bet_medium")).toBeCloseTo(4.125);
    expect(actionAmountBb(spot({}), "bet_large")).toBeCloseTo(6.875);
  });

  it("matches the solver's raise arithmetic when facing a bet", () => {
    // BB bets 25% of 5.5 = 1.375; a 75% raise is call + 0.75 * (pot + 2 * bet).
    const s = facingSmall();
    expect(betAmount(s)).toBeCloseTo(1.375);
    expect(actionAmountBb(s, "call")).toBeCloseTo(1.375);
    expect(actionAmountBb(s, "bet_medium")).toBeCloseTo(1.375 + 0.75 * (5.5 + 2 * 1.375));
  });

  it("is the whole stack for all-in, and nothing for fold/check", () => {
    expect(actionAmountBb(spot({}), "all_in")).toBe(97.5);
    expect(actionAmountBb(spot({}), "check")).toBeNull();
    expect(actionAmountBb(facingSmall(), "fold")).toBeNull();
  });

  it("never exceeds the stack", () => {
    expect(actionAmountBb(spot({ stackBb: 3 }), "bet_large")).toBe(3);
  });
});

describe("actionParts / actionText", () => {
  it("leads with bb or with percent depending on the setting", () => {
    expect(actionParts(spot({}), "bet_medium", "bb")).toEqual({ main: "4.1bb", sub: "75% pot" });
    expect(actionParts(spot({}), "bet_medium", "pct")).toEqual({ main: "75%", sub: "4.1bb" });
  });

  it("keeps fold, check, call, all-in the same either way", () => {
    expect(actionParts(spot({}), "check", "bb")).toEqual({ main: "Check", sub: null });
    expect(actionParts(facingSmall(), "call", "pct")).toEqual({ main: "Call", sub: "1.4bb" });
    expect(actionParts(spot({}), "all_in", "bb")).toEqual({ main: "All-in", sub: "97.5bb" });
  });

  it("writes a one-line description, Bet vs Raise to", () => {
    expect(actionText(spot({}), "bet_medium", "bb")).toBe("Bet 4.1bb (75%)");
    expect(actionText(facingSmall(), "bet_medium", "pct")).toBe("Raise to 75% (7.6bb)");
    expect(actionText(spot({}), "check", "bb")).toBe("Check");
  });
});

describe("formatBb", () => {
  it("trims to one decimal without a trailing .0", () => {
    expect(formatBb(97.5)).toBe("97.5");
    expect(formatBb(12)).toBe("12");
    expect(formatBb(4.125)).toBe("4.1");
  });
});

describe("shuffled", () => {
  it("is deterministic for a seed and keeps every item", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect([...shuffled(items, 7)].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
