import pairData from "../data/preflop-pairs.json";
import opens from "../data/open-ranges.json";
import { cardsFor } from "./openRanges";
import {
  FOUR_BET_TO,
  OPEN_TO,
  SEATS,
  THREE_BET_TO,
  actionLabel,
  applyAction,
  dealHand,
  describeNode,
  labelFor,
  mulberry32,
  startNode,
  type Deal,
  type Seat,
} from "./practiceTable";

type Pair = { flat: string[]; threeBet: string[]; callVs3: string[]; fourBet: string[]; callVs4: string[] };
const PAIRS = pairData as Record<string, Pair>;
const OPENS = opens as Record<string, string[]>;

const JUNK = "72o"; // in no range anywhere
const cards = (label: string) => cardsFor(label);

/** A deal with the given hands (as labels); every other seat holds junk. */
function deal(hero: Seat, hands: Partial<Record<Seat, string>> = {}): Deal {
  const all = Object.fromEntries(SEATS.map((s) => [s, cards(hands[s] ?? JUNK)])) as Deal["hands"];
  return { hero, hands: all };
}

describe("labelFor", () => {
  it("names a hand the way the charts do", () => {
    expect(labelFor("Ah", "Kd")).toBe("AKo");
    expect(labelFor("Kd", "Ah")).toBe("AKo");
    expect(labelFor("Ah", "Kh")).toBe("AKs");
    expect(labelFor("7s", "7c")).toBe("77");
    expect(labelFor("2h", "9h")).toBe("92s");
    expect(labelFor("Ts", "9d")).toBe("T9o");
  });

  it("agrees with the card pair the lessons draw for a label", () => {
    for (const label of ["AKo", "T9s", "55", "72o"]) expect(labelFor(...cards(label))).toBe(label);
  });
});

describe("the first decision", () => {
  it("first in: raise a hand in the seat's opening range, fold one that isn't", () => {
    const inRange = OPENS.UTG[0];
    const node = startNode(deal("UTG", { UTG: inRange }))!;
    expect(node).toMatchObject({ kind: "open", seat: "UTG", options: ["fold", "raise"], correct: "raise", hand: inRange });
    expect(startNode(deal("UTG", { UTG: JUNK }))!.correct).toBe("fold");
  });

  it("the bots in front of you open from the charts and the ones behind the opener fold", () => {
    const aa = "AA";
    const node = startNode(deal("BB", { UTG: "72o", HJ: aa, CO: aa, BTN: aa }))!;
    expect(node.kind).toBe("vs-open");
    expect(node.opponent).toBe("HJ"); // the first seat in range opens; CO and BTN can't cold-call or 3-bet
    expect(node.table.log).toEqual(["UTG folds", "HJ raises to 2.5bb", "CO folds", "BTN folds", "SB folds"]);
    expect(node.table.bets.HJ).toBe(OPEN_TO);
    expect(node.table.folded.CO).toBe(true);
  });

  it("the blinds' money is on the table before anyone acts", () => {
    const node = startNode(deal("UTG", { UTG: JUNK }))!;
    expect(node.table.bets).toMatchObject({ SB: 0.5, BB: 1, UTG: 0 });
  });

  it("grades each defender decision from the pair's ranges", () => {
    const pair = PAIRS["BTN>BB"];
    const pick = (list: string[]) => list[0];
    for (const [hand, best] of [
      [pick(pair.threeBet), "raise"],
      [pick(pair.flat), "call"],
      [JUNK, "fold"],
    ] as const) {
      const node = startNode(deal("BB", { UTG: JUNK, HJ: JUNK, CO: JUNK, BTN: OPENS.BTN[0], SB: JUNK, BB: hand }))!;
      expect(node).toMatchObject({ kind: "vs-open", opponent: "BTN", options: ["fold", "call", "raise"], correct: best });
    }
  });

  it("skips spots the charts can't grade, so the dealer deals again", () => {
    expect(startNode(deal("BB"))).toBeNull(); // everyone folds to the big blind
    expect(startNode(deal("CO", { UTG: "AA" }))).toBeNull(); // CO has no chart against a UTG open
    expect(startNode(deal("BB", { UTG: JUNK, HJ: JUNK, CO: JUNK, BTN: JUNK, SB: "AA" }))).toMatchObject({ opponent: "SB" });
  });
});

describe("what happens after you act", () => {
  const BTN_OPEN = OPENS.BTN[0];

  it("folding ends the hand, and says whether the chart agreed", () => {
    const d = deal("UTG", { UTG: OPENS.UTG[0] });
    const out = applyAction(d, startNode(d)!, "fold");
    expect(out).toMatchObject({ correct: false, best: "raise", next: null, summary: "You folded." });
    expect(out.table.folded.UTG).toBe(true);
    const junk = deal("UTG");
    expect(applyAction(junk, startNode(junk)!, "fold").correct).toBe(true);
  });

  it("an open that nobody answers wins the blinds", () => {
    const d = deal("BTN", { BTN: BTN_OPEN });
    const out = applyAction(d, startNode(d)!, "raise");
    expect(out).toMatchObject({ correct: true, next: null, summary: "Everyone folded. You win the blinds." });
    expect(out.table.bets.BTN).toBe(OPEN_TO);
    expect(out.table.log.at(-1)).toBe("BB folds");
  });

  it("an open can be called by a bot whose hand is in its calling range", () => {
    const flat = PAIRS["BTN>BB"].flat[0];
    const d = deal("BTN", { BTN: BTN_OPEN, BB: flat });
    const out = applyAction(d, startNode(d)!, "raise");
    expect(out.next).toBeNull();
    expect(out.summary).toContain(`BB called with ${flat}`);
    expect(out.table.bets.BB).toBe(OPEN_TO);
  });

  it("an open can be 3-bet, and you then answer a 3-bet, graded from the pair", () => {
    const three = PAIRS["BTN>BB"].threeBet[0];
    for (const [hand, best] of [
      [PAIRS["BTN>BB"].fourBet[0], "raise"],
      [PAIRS["BTN>BB"].callVs3[0], "call"],
    ] as const) {
      const d = deal("BTN", { BTN: hand, BB: three });
      const out = applyAction(d, startNode(d)!, "raise");
      expect(out.next).toMatchObject({ kind: "vs-3bet", opponent: "BB", correct: best, options: ["fold", "call", "raise"] });
      expect(out.table.bets.BB).toBe(THREE_BET_TO);
    }
  });

  it("the first bot that acts ends the round: a 3-bet from SB means BB never gets to respond", () => {
    const d = deal("BTN", { BTN: BTN_OPEN, SB: PAIRS["BTN>SB"].threeBet[0], BB: PAIRS["BTN>BB"].threeBet[0] });
    const out = applyAction(d, startNode(d)!, "raise");
    expect(out.next!.opponent).toBe("SB");
  });

  it("3-betting a raise: the opener folds, calls or 4-bets from its own ranges", () => {
    const hero: Seat = "BB";
    const pair = PAIRS["BTN>BB"];
    const heroHand = pair.threeBet[0];
    const run = (openerHand: string) => {
      const d = deal(hero, { BTN: openerHand, BB: heroHand });
      // BTN must open to get here: use a hand in the open range that is also in the target set.
      return { d, out: applyAction(d, startNode(d)!, "raise") };
    };
    const fourBet = pair.fourBet[0];
    expect(OPENS.BTN).toContain(fourBet); // the invariant the data test enforces
    const a = run(fourBet);
    expect(a.out.next).toMatchObject({ kind: "vs-4bet", opponent: "BTN", options: ["fold", "call"] });
    expect(a.out.table.bets.BTN).toBe(FOUR_BET_TO);

    const b = run(pair.callVs3[0]);
    expect(b.out).toMatchObject({ next: null });
    expect(b.out.summary).toContain("called your 3-bet");

    const foldingHand = OPENS.BTN.find((h) => !pair.fourBet.includes(h) && !pair.callVs3.includes(h))!;
    const c = run(foldingHand);
    expect(c.out.summary).toContain("folded");
    expect(c.out.table.folded.BTN).toBe(true);
  });

  it("calling an open ends the hand with a flop", () => {
    const d = deal("BB", { BTN: BTN_OPEN, BB: PAIRS["BTN>BB"].flat[0] });
    const out = applyAction(d, startNode(d)!, "call");
    expect(out).toMatchObject({ correct: true, next: null });
    expect(out.summary).toMatch(/see a flop/);
  });

  it("a 4-bet you face is graded against the hands that continue, and 4-betting back isn't offered", () => {
    const pair = PAIRS["BTN>BB"];
    const mk = (hand: string) => {
      const d = deal("BB", { BTN: pair.fourBet[0], BB: hand });
      const first = applyAction(d, startNode(d)!, "raise");
      return { d, node: first.next! };
    };
    const keep = pair.callVs4[0];
    const { d, node } = mk(keep);
    expect(node.options).toEqual(["fold", "call"]);
    expect(node.correct).toBe("call");
    expect(applyAction(d, node, "call")).toMatchObject({ correct: true, next: null });
    expect(applyAction(d, node, "fold")).toMatchObject({ correct: false, best: "call" });

    const giveUp = pair.threeBet.find((h) => !pair.callVs4.includes(h))!;
    expect(mk(giveUp).node.correct).toBe("fold");
  });

  it("4-betting a 3-bet: the 3-bettor continues only with hands from its calling-a-4-bet range", () => {
    const pair = PAIRS["BTN>BB"];
    const heroHand = pair.fourBet[0];
    const runWith = (bbHand: string) => {
      const d = deal("BTN", { BTN: heroHand, BB: bbHand });
      const third = applyAction(d, startNode(d)!, "raise").next!;
      return applyAction(d, third, "raise");
    };
    // BB must 3-bet to get here, so use hands in its 3-bet range.
    const keeps = pair.threeBet.find((h) => pair.callVs4.includes(h))!;
    expect(runWith(keeps).summary).toContain("called your 4-bet");
    const folds = pair.threeBet.find((h) => !pair.callVs4.includes(h))!;
    expect(runWith(folds).summary).toContain("folded");
  });
});

describe("dealing", () => {
  it("is repeatable from a seed and always lands on a decision the charts can grade", () => {
    const a = dealHand(mulberry32(7));
    const b = dealHand(mulberry32(7));
    expect(a.deal).toEqual(b.deal);
    expect(a.node.explanation).toBe(b.node.explanation);
  });

  it("every dealt node has exactly one right answer among its options", () => {
    const rng = mulberry32(2024);
    for (let i = 0; i < 400; i++) {
      const { node } = dealHand(rng);
      expect(node.options).toContain(node.correct);
      expect(node.options).toEqual(node.options.includes("call") ? ["fold", "call", "raise"] : ["fold", "raise"]);
      expect(node.explanation.length).toBeGreaterThan(10);
    }
  });

  it("honours the filter, and the mix covers both kinds of first decision", () => {
    const rng = mulberry32(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      expect(dealHand(rng, "open").node.kind).toBe("open");
      expect(dealHand(rng, "defend").node.kind).toBe("vs-open");
      kinds.add(dealHand(rng, "all").node.kind);
    }
    expect(kinds).toEqual(new Set(["open", "vs-open"]));
  });

  it("the big blind never gets a first-in decision and no one is dealt the same card twice", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const { deal: d, node } = dealHand(rng, "open");
      expect(node.seat).not.toBe("BB");
      const all = SEATS.flatMap((s) => d.hands[s]);
      expect(new Set(all).size).toBe(12);
    }
  });

  it("plays every chart pair through to the end without losing a hand", () => {
    // Every (opener, defender) pair in the data can be reached and finished from both sides.
    for (const key of Object.keys(PAIRS)) {
      const [opener, defender] = key.split(">") as [Seat, Seat];
      const pair = PAIRS[key];
      const between: Partial<Record<Seat, string>> = {};
      // the opener opens, everyone between folds
      const d = deal(defender, { ...between, [opener]: pair.fourBet[0], [defender]: pair.threeBet[0] });
      const first = startNode(d);
      expect(first, key).toMatchObject({ kind: "vs-open", opponent: opener });
      let outcome = applyAction(d, first!, "raise");
      let steps = 0;
      while (outcome.next && steps++ < 4) outcome = applyAction(d, outcome.next, "call");
      expect(outcome.summary, key).toBeTruthy();
    }
  });
});

describe("wording", () => {
  it("labels the buttons for the spot", () => {
    const d = deal("BB", { BTN: OPENS.BTN[0], BB: PAIRS["BTN>BB"].flat[0] });
    const node = startNode(d)!;
    expect(actionLabel(node, "fold")).toBe("Fold");
    expect(actionLabel(node, "call")).toBe("Call 2.5bb");
    expect(actionLabel(node, "raise")).toBe("3-bet to 9bb");
    const open = startNode(deal("UTG"))!;
    expect(actionLabel(open, "raise")).toBe("Raise to 2.5bb");
    expect(describeNode(node)).toMatch(/BTN raised to 2.5bb/);
    expect(describeNode(open)).toMatch(/everyone has folded to you/);
  });

  it("explains in terms of the chart, and says the ranges are approximate", () => {
    const d = deal("BB", { BTN: OPENS.BTN[0], BB: PAIRS["BTN>BB"].threeBet[0] });
    const node = startNode(d)!;
    expect(node.explanation).toMatch(/is a 3-bet against the BTN's open from the BB/);
    expect(node.explanation).toMatch(/approximate reference ranges/);
  });
});
