import { assignPostflopSeats } from "./positions";

describe("assignPostflopSeats", () => {
  it.each([
    ["UTG", "BB", "BB", "UTG"],
    ["BTN", "SB", "SB", "BTN"],
    ["BB", "SB", "SB", "BB"],
    ["CO", "BTN", "CO", "BTN"],
    ["HJ", "UTG", "UTG", "HJ"],
  ] as const)("%s vs %s -> %s out of position, %s in position", (a, b, oop, ip) => {
    expect(assignPostflopSeats(a, b)).toEqual({ oop, ip });
    expect(assignPostflopSeats(b, a)).toEqual({ oop, ip });
  });
});
