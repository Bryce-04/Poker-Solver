import { cardsText, handText, spotFromHistory, whenText } from "./coachText";

describe("coachText", () => {
  it("writes hands and cards with suit symbols", () => {
    expect(handText("AhQd")).toBe("A♥ Q♦");
    expect(handText("Ts9s")).toBe("10♠ 9♠");
    expect(handText("AQo")).toBe("AQo");
    expect(handText(null)).toBe("");
    expect(cardsText(["Qs", "5c", "2c"])).toBe("Q♠ 5♣ 2♣");
  });

  it("turns a parsed hand history into the spot the backend uses as it is", () => {
    const spot = spotFromHistory({
      oopPosition: "BB",
      ipPosition: "BTN",
      effectiveStackBb: 97.5,
      potBb: 5.5,
      board: ["Qs", "5c", "2c"],
      oopAlreadyChecked: true,
    });
    expect(spot).toEqual({
      positions_in_hand: ["BB", "BTN"],
      effective_stack_bb: 97.5,
      pot_bb: 5.5,
      board: ["Qs", "5c", "2c"],
      current_street: "flop",
      actions: [{ position: "BB", street: "flop", action: "check" }],
      ranges: {},
    });
    expect(
      spotFromHistory({ oopPosition: "SB", ipPosition: "BB", effectiveStackBb: 90, potBb: 20, board: ["Qs", "5c", "2c", "9h"], oopAlreadyChecked: false }),
    ).toMatchObject({ current_street: "turn", actions: [] });
  });

  it("says when a conversation was last touched", () => {
    const now = new Date(2026, 10, 5, 15, 0);
    expect(whenText(new Date(2026, 10, 5, 9, 41).toISOString(), now)).toMatch(/^Today, 9:41/);
    expect(whenText(new Date(2026, 10, 4, 22, 0).toISOString(), now)).toBe("Yesterday");
    expect(whenText(new Date(2026, 9, 20, 12, 0).toISOString(), now)).toMatch(/Oct 20/);
  });
});
