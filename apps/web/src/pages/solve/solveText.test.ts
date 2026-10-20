import { computeStreetState, type BuilderAction } from "../../lib/handBuilder";
import {
  accuracyOf,
  aggressionLine,
  describePreflop,
  exploreOptions,
  handAdvice,
  headline,
  potType,
  preflopRole,
  rangeNote,
} from "./solveText";

const OPEN_CALL: BuilderAction[] = [
  { position: "BTN", action: "raise", toBb: 2.5 },
  { position: "BB", action: "call" },
];
const THREE_BET: BuilderAction[] = [
  { position: "BTN", action: "raise", toBb: 2.5 },
  { position: "BB", action: "raise", toBb: 11 },
  { position: "BTN", action: "call" },
];

describe("solveText", () => {
  it("describes the preflop line, the pot type and each player's role", () => {
    expect(describePreflop(OPEN_CALL)).toBe("BTN raised, BB called");
    expect(potType(OPEN_CALL)).toBe("single-raised pot");
    expect(preflopRole("BTN", OPEN_CALL)).toBe("opened the pot");
    expect(preflopRole("BB", OPEN_CALL)).toBe("called the open");

    expect(describePreflop(THREE_BET)).toBe("BTN raised, BB 3-bet, BTN called");
    expect(potType(THREE_BET)).toBe("3-bet pot");
    expect(preflopRole("BB", THREE_BET)).toBe("3-bet");
    expect(preflopRole("BTN", THREE_BET)).toBe("called the 3-bet");

    const limp: BuilderAction[] = [
      { position: "SB", action: "call" },
      { position: "BB", action: "check" },
    ];
    expect(describePreflop(limp)).toBe("SB limped, BB checked");
    expect(potType(limp)).toBe("limped pot");
  });

  it("grades accuracy by exploitability, and a cut-short solve as rough", () => {
    expect(accuracyOf(0.4, true).tier).toBe("very");
    expect(accuracyOf(1.2, true).title).toBe("Accurate");
    expect(accuracyOf(2, true).tier).toBe("rough");
    expect(accuracyOf(0.1, false).tier).toBe("rough");
  });

  it("turns a hand's mix into advice by how lopsided it is", () => {
    expect(handAdvice({ check: 1 }, "BTN")).toBe("Always check.");
    expect(handAdvice({ check: 0.85, bet_small: 0.15 }, "BTN")).toBe("Almost always check.");
    expect(handAdvice({ check: 0.6, bet_small: 0.4 }, "BTN")).toBe(
      "Usually check, sometimes bet small (25%). Both are fine: the solver mixes on purpose so BTN can't read your hand.",
    );
    expect(handAdvice({ check: 0.4, bet_small: 0.35, bet_medium: 0.25 }, "BTN")).toMatch(/^A close mix/);
  });

  it("leads with the range's most common action, then who bets", () => {
    const mix: [string, number][] = [
      ["check", 0.7],
      ["bet_small", 0.3],
    ];
    expect(headline("BB", "flop", mix)).toBe("BB checks 70% of the time on this flop.");
    const strategy = { AA: { bet_small: 0.9, check: 0.1 }, "72o": { check: 1 }, KK: { bet_small: 0.6, check: 0.4 } };
    expect(aggressionLine(strategy, { AA: 6, "72o": 12, KK: 6 }, mix)).toBe("It bets most often with AA and KK.");
    expect(aggressionLine({ "72o": { check: 1 } }, { "72o": 12 }, [["check", 1]])).toMatch(/almost never bets/);
  });

  it("notes a caller's partly filled premium pairs, only for a caller", () => {
    expect(rangeNote("BB", "called the open", { AA: 0.5, KK: 1 })).toMatch(/AA and KK are only partly filled/);
    expect(rangeNote("BB", "called the open", { AA: 1, KK: 1 })).toBeNull();
    expect(rangeNote("BTN", "opened the pot", { AA: 0.5 })).toBeNull();
  });

  it("offers only the legal next actions worth solving", () => {
    const ctx = { oopPosition: "BB" as const, ipPosition: "BTN" as const, potBeforeBb: 5.5, stackBeforeBb: 97.5, firstToAct: "BB" as const };
    const root = exploreOptions("flop", computeStreetState(ctx, []), [], "BB", "BTN");
    expect(root.map((o) => o.label)).toEqual(["What does BTN do if BB checks?", "What if BB bets small?"]);
    expect(root[1].action).toEqual({ position: "BB", action: "bet", toBb: 1.4 });

    const afterCheck: BuilderAction[] = [{ position: "BB", action: "check" }];
    const ipNode = exploreOptions("flop", computeStreetState(ctx, afterCheck), afterCheck, "BB", "BTN");
    expect(ipNode[0]).toMatchObject({ label: "What if BTN checks too? Deal a turn card", dealsNext: "turn" });

    const facing: BuilderAction[] = [{ position: "BB", action: "bet", toBb: 2 }];
    const vsBet = exploreOptions("flop", computeStreetState(ctx, facing), facing, "BB", "BTN");
    expect(vsBet.map((o) => o.label)).toEqual(["What if BTN calls? Deal a turn card"]);

    // The river can't deal another card.
    expect(exploreOptions("river", computeStreetState(ctx, afterCheck), afterCheck, "BB", "BTN").map((o) => o.label)).toEqual([
      "What if BTN bets small?",
    ]);
  });
});
