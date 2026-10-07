import { formatMix, overallMix } from "./strategySummary";

describe("overallMix", () => {
  it("averages each action across hands, in a fixed order", () => {
    const mix = overallMix({
      AA: { bet_small: 1 },
      KK: { check: 0.5, bet_small: 0.5 },
    });
    expect(mix).toEqual([
      ["check", 0.25],
      ["bet_small", 0.75],
    ]);
  });

  it("drops actions under 0.5% and returns nothing for an empty strategy", () => {
    expect(overallMix({})).toEqual([]);
    expect(overallMix({ AA: { check: 0.999, fold: 0.001 } }).map(([a]) => a)).toEqual(["check"]);
  });
});

describe("formatMix", () => {
  it("renders labels and rounded percentages", () => {
    expect(formatMix([["check", 0.384], ["all_in", 0.616]])).toBe("Check 38%, All-in 62%");
  });
});
