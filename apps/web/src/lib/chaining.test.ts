import type { Street } from "@poker-solver/schema";
import { buildNarrowSpot, describeStreets, streetsToNarrow, unlikelyLineWarning } from "./chaining";
import type { BuilderAction } from "./handBuilder";

const streets = (overrides: Partial<Record<Street, BuilderAction[]>>) => ({
  preflop: [] as BuilderAction[],
  flop: [] as BuilderAction[],
  turn: [] as BuilderAction[],
  river: [] as BuilderAction[],
  ...overrides,
});

// BTN opens to 2.5, BB calls: a 5.5bb pot (2.5 + 2.5, plus the SB's dead 0.5).
const PREFLOP: BuilderAction[] = [
  { position: "BTN", action: "raise", toBb: 2.5 },
  { position: "BB", action: "call" },
];

describe("streetsToNarrow", () => {
  it("narrows by every postflop street before the target", () => {
    expect(streetsToNarrow("flop")).toEqual([]);
    expect(streetsToNarrow("turn")).toEqual(["flop"]);
    expect(streetsToNarrow("river")).toEqual(["flop", "turn"]);
    expect(describeStreets(["flop", "turn"])).toBe("the flop and turn");
  });
});

describe("buildNarrowSpot", () => {
  it("sends the flop with its own pot, board and actions", () => {
    const spot = buildNarrowSpot({
      oopPosition: "BB",
      ipPosition: "BTN",
      startingStackBb: 100,
      streets: streets({
        preflop: PREFLOP,
        flop: [
          { position: "BB", action: "check" },
          { position: "BTN", action: "check" },
        ],
      }),
      board: ["7h", "2h", "9c", "Ks"],
      street: "flop",
      oopRange: { AA: 1 },
      ipRange: { KK: 1 },
    });
    expect(spot.current_street).toBe("flop");
    expect(spot.board).toEqual(["7h", "2h", "9c"]); // not the turn card
    expect(spot.positions_in_hand).toEqual(["BB", "BTN"]);
    expect(spot.pot_bb).toBe(5.5);
    expect(spot.actions?.map((a) => `${a.position}:${a.street}:${a.action}`)).toEqual([
      "BB:flop:check",
      "BTN:flop:check",
    ]);
    expect(spot.ranges).toEqual({ BB: { AA: 1 }, BTN: { KK: 1 } });
  });

  it("the turn's pot includes the flop's bet and call", () => {
    const spot = buildNarrowSpot({
      oopPosition: "BB",
      ipPosition: "BTN",
      startingStackBb: 100,
      streets: streets({
        preflop: PREFLOP,
        flop: [
          { position: "BB", action: "bet", toBb: 3 },
          { position: "BTN", action: "call" },
        ],
        turn: [
          { position: "BB", action: "check" },
          { position: "BTN", action: "check" },
        ],
      }),
      board: ["7h", "2h", "9c", "Ks", "3d"],
      street: "turn",
      oopRange: { AA: 1 },
      ipRange: { KK: 1 },
    });
    expect(spot.board).toHaveLength(4);
    expect(spot.pot_bb).toBe(11.5); // 5.5 + 3 + 3
  });
});

describe("unlikelyLineWarning", () => {
  it("is quiet for a line both players take, loud for one nobody does", () => {
    expect(unlikelyLineWarning("flop", { BB: 0.9, BTN: 0.2 })).toBeNull();
    const warning = unlikelyLineWarning("flop", { BB: 0.0001, BTN: 0.5 });
    expect(warning).toContain("BB (0.0%)");
    expect(warning).not.toContain("BTN");
  });
});
