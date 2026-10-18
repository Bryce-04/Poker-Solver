import {
  comboColumns,
  comboSlots,
  canonicalComboKey,
  comboLabel,
  comboWeights,
  indexRange,
  isPartial,
  labelCombos,
  labelWeight,
  setComboWeight,
  setLabelWeight,
  totalCombos,
} from "./rangeCombos";

describe("combo keys", () => {
  it("counts combos per hand type", () => {
    expect(labelCombos("AA")).toHaveLength(6);
    expect(labelCombos("AKs")).toHaveLength(4);
    expect(labelCombos("AKo")).toHaveLength(12);
  });

  it("canonicalizes to higher card first, matching the solver", () => {
    expect(canonicalComboKey("KhAh")).toBe("AhKh");
    expect(canonicalComboKey("ahkh")).toBe("AhKh");
    // Same rank: suit order is s < h < d < c, higher first.
    expect(canonicalComboKey("AsAh")).toBe("AhAs");
    expect(canonicalComboKey("AhAh")).toBeNull();
    expect(canonicalComboKey("AhKz")).toBeNull();
  });

  it("maps a combo back to its hand type", () => {
    expect(comboLabel("AhKh")).toBe("AKs");
    expect(comboLabel("AhKd")).toBe("AKo");
    expect(comboLabel("AhAs")).toBe("AA");
    expect(labelCombos("T9s").every((c) => comboLabel(c) === "T9s")).toBe(true);
  });
});

describe("combo-aware range reads", () => {
  it("a combo key overrides its label's weight for that combo", () => {
    const index = indexRange({ AKs: 1, AhKh: 0.25 });
    const w = comboWeights(index, "AKs");
    expect(w.AhKh).toBe(0.25);
    expect(w.AsKs).toBe(1);
    expect(labelWeight(index, "AKs")).toBeCloseTo((0.25 + 3) / 4);
    expect(isPartial(index, "AKs")).toBe(true);
  });

  it("a combo key with no label key means only that combo", () => {
    const index = indexRange({ AhKh: 1 });
    expect(labelWeight(index, "AKs")).toBe(0.25);
    expect(totalCombos(index)).toBe(1);
  });

  it("sums weighted combos across labels and overrides", () => {
    expect(totalCombos(indexRange({ AA: 1, AKs: 0.5, AhKh: 0 }))).toBeCloseTo(6 + 1.5);
  });
});

describe("combo-aware range writes", () => {
  it("setting a whole hand type clears its combo overrides", () => {
    expect(setLabelWeight({ AKs: 1, AhKh: 0, AA: 1 }, "AKs", 0)).toEqual({ AA: 1 });
    expect(setLabelWeight({ AhKh: 1, AsKs: 1 }, "AKs", 0.5)).toEqual({ AKs: 0.5 });
  });

  it("removing one combo splits the label into live combo keys", () => {
    const next = setComboWeight({ AKs: 1 }, "AKs", "AhKh", 0);
    expect(next).toEqual({ AsKs: 1, AdKd: 1, AcKc: 1 });
  });

  it("restoring the last differing combo collapses back to the label", () => {
    const split = setComboWeight({ AKs: 1 }, "AKs", "AhKh", 0);
    expect(setComboWeight(split, "AKs", "AhKh", 1)).toEqual({ AKs: 1 });
  });

  it("leaves other hand types alone", () => {
    const next = setComboWeight({ AKs: 1, QQ: 1 }, "AKs", "AcKc", 0.5);
    expect(next.QQ).toBe(1);
    expect(next.AKs).toBeUndefined();
    expect(next.AcKc).toBe(0.5);
  });

  it("emptying every combo removes the hand type", () => {
    expect(setComboWeight({ AhKh: 1 }, "AKs", "AhKh", 0)).toEqual({});
  });
});

describe("suit layout", () => {
  it("lays out suited hands in one row, pairs in two rows of three, offsuit as a 4x4 with a blank diagonal", () => {
    const suited = comboSlots("AKs");
    expect(suited).toHaveLength(4);
    expect(suited.every((s) => s.combo !== null)).toBe(true);
    expect(comboColumns("AKs")).toBe(4);

    const pair = comboSlots("QQ");
    expect(pair).toHaveLength(6);
    expect(comboColumns("QQ")).toBe(3);

    const offsuit = comboSlots("AKo");
    expect(offsuit).toHaveLength(16);
    expect(offsuit.filter((s) => s.combo === null)).toHaveLength(4);
    expect(comboColumns("AKo")).toBe(4);
  });

  it("lists every combo of a hand exactly once", () => {
    for (const hand of ["AA", "AKs", "AKo"]) {
      const keys = comboSlots(hand).flatMap((s) => (s.combo ? [s.combo] : []));
      expect(new Set(keys)).toEqual(new Set(labelCombos(hand)));
      expect(keys).toHaveLength(labelCombos(hand).length);
    }
  });
});
