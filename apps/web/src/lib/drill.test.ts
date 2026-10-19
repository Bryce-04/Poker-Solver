import { describe, expect, it } from "vitest";
import {
  actionLabel,
  directionAction,
  gradeAction,
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

describe("directionAction", () => {
  const facing = spot({
    situation: "facing_bet",
    facing: "bet_small",
    actions: ["fold", "call", "bet_small", "bet_medium", "bet_large", "all_in"],
  });

  it("maps left to check when nothing is bet, fold when facing a bet", () => {
    expect(directionAction(spot({}), "left")).toBe("check");
    expect(directionAction(facing, "left")).toBe("fold");
  });

  it("only allows calling when facing a bet", () => {
    expect(directionAction(spot({}), "right")).toBeNull();
    expect(directionAction(facing, "right")).toBe("call");
  });

  it("asks for a size when several bets are legal", () => {
    expect(directionAction(spot({}), "up")).toBe("size");
    expect(directionAction(spot({ actions: ["check", "all_in"] }), "up")).toBe("all_in");
  });
});

describe("actionLabel", () => {
  it("says Bet or Raise depending on whether a bet is faced", () => {
    expect(actionLabel("bet_medium", false)).toBe("Bet 75%");
    expect(actionLabel("bet_medium", true)).toBe("Raise 75%");
    expect(actionLabel("all_in", true)).toBe("All-in");
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
