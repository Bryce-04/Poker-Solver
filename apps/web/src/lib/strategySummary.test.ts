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

describe("overallMix weighted by how much of the range each hand is", () => {
  it("counts a hand barely in the range for little, and a hand not in it for nothing", () => {
    const strategy = {
      AA: { check: 1 }, // 6 combos at full weight
      KK: { all_in: 1 }, // 6 combos at 1%: almost not there
      QQ: { all_in: 1 }, // not in the range at all
    };
    // Unweighted, the 'average hand' jams 2/3 of the time.
    expect(overallMix(strategy).find(([a]) => a === "all_in")?.[1]).toBeCloseTo(2 / 3);
    const weighted = overallMix(strategy, { AA: 6, KK: 0.06 });
    expect(weighted.find(([a]) => a === "all_in")?.[1]).toBeCloseTo(0.06 / 6.06);
    expect(weighted.find(([a]) => a === "check")?.[1]).toBeCloseTo(6 / 6.06);
  });

  it("is empty when no solved hand has any weight", () => {
    expect(overallMix({ AA: { check: 1 } }, {})).toEqual([]);
  });
});

describe("formatMix", () => {
  it("renders labels and rounded percentages", () => {
    expect(formatMix([["check", 0.384], ["all_in", 0.616]])).toBe("Check 38%, All-in 62%");
  });
});
