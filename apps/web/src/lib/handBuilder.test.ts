import { computeStreetState, preflopContext, summarizeHand, toBettingActions } from "./handBuilder";
import type { BuilderAction, StreetContext } from "./handBuilder";

const PREFLOP_CTX: StreetContext = {
  oopPosition: "BB",
  ipPosition: "BTN",
  potBeforeBb: 0,
  stackBeforeBb: 100,
  firstToAct: "BTN",
  initialContributed: { BB: 1, BTN: 0.5 },
  isPreflop: true,
};

const FRESH_POSTFLOP_CTX: StreetContext = {
  oopPosition: "BB",
  ipPosition: "BTN",
  potBeforeBb: 6.5,
  stackBeforeBb: 97,
  firstToAct: "BB",
};

describe("computeStreetState -- preflop", () => {
  it("has the small blind facing the big blind's gap with no actions yet", () => {
    const state = computeStreetState(PREFLOP_CTX, []);
    expect(state.toAct).toBe("BTN");
    expect(state.facingBet).toBe(true);
    expect(state.toCallBb).toBe(0.5);
    expect(state.isTerminal).toBe(false);
  });

  it("does not close when the small blind just completes (limps)", () => {
    const actions: BuilderAction[] = [{ position: "BTN", action: "call" }];
    const state = computeStreetState(PREFLOP_CTX, actions);
    expect(state.isTerminal).toBe(false);
    expect(state.toAct).toBe("BB");
    expect(state.facingBet).toBe(false);
    expect(state.aggressiveLabel).toBe("raise"); // 1bb already in, not a fresh bet
  });

  it("closes once the big blind checks behind a completed limp", () => {
    const actions: BuilderAction[] = [
      { position: "BTN", action: "call" },
      { position: "BB", action: "check" },
    ];
    const state = computeStreetState(PREFLOP_CTX, actions);
    expect(state.isTerminal).toBe(true);
    expect(state.potAfterBb).toBe(2); // 1 (BB) + 1 (BTN, matched)
    expect(state.stackAfterBb).toBe(99);
  });

  it("supports a 3-bet and 4-bet before closing", () => {
    const actions: BuilderAction[] = [
      { position: "BTN", action: "raise", toBb: 3 }, // open to 3
      { position: "BB", action: "raise", toBb: 9 }, // 3-bet to 9
      { position: "BTN", action: "raise", toBb: 21 }, // 4-bet to 21
      { position: "BB", action: "call" },
    ];
    const state = computeStreetState(PREFLOP_CTX, actions);
    expect(state.isTerminal).toBe(true);
    expect(state.potAfterBb).toBe(42); // both matched at 21
    expect(state.stackAfterBb).toBe(79);
  });

  it("ends the hand on a fold, with no pot/stack to carry forward", () => {
    const actions: BuilderAction[] = [
      { position: "BTN", action: "raise", toBb: 3 },
      { position: "BB", action: "fold" },
    ];
    const state = computeStreetState(PREFLOP_CTX, actions);
    expect(state.isTerminal).toBe(true);
    expect(state.folded).toBe("BB");
  });

  it("treats an all-in as committing the whole starting stack", () => {
    const actions: BuilderAction[] = [{ position: "BTN", action: "all_in" }];
    const state = computeStreetState(PREFLOP_CTX, actions);
    expect(state.remainingBb.BTN).toBe(0);
    expect(state.toCallBb).toBe(99); // BB has 1 in, needs 99 more to match 100
  });
});

describe("computeStreetState -- postflop", () => {
  it("offers a true opening bet (not a raise) on a fresh street", () => {
    const state = computeStreetState(FRESH_POSTFLOP_CTX, []);
    expect(state.toAct).toBe("BB");
    expect(state.facingBet).toBe(false);
    expect(state.aggressiveLabel).toBe("bet");
  });

  it("does not close after a single opening check", () => {
    const state = computeStreetState(FRESH_POSTFLOP_CTX, [{ position: "BB", action: "check" }]);
    expect(state.isTerminal).toBe(false);
    expect(state.toAct).toBe("BTN");
  });

  it("closes on check-check", () => {
    const actions: BuilderAction[] = [
      { position: "BB", action: "check" },
      { position: "BTN", action: "check" },
    ];
    const state = computeStreetState(FRESH_POSTFLOP_CTX, actions);
    expect(state.isTerminal).toBe(true);
    expect(state.potAfterBb).toBe(6.5); // nothing wagered
    expect(state.stackAfterBb).toBe(97);
  });

  it("closes on a call after a bet", () => {
    const actions: BuilderAction[] = [
      { position: "BB", action: "bet", toBb: 5 },
      { position: "BTN", action: "call" },
    ];
    const state = computeStreetState(FRESH_POSTFLOP_CTX, actions);
    expect(state.isTerminal).toBe(true);
    expect(state.potAfterBb).toBe(16.5); // 6.5 + 5 + 5
    expect(state.stackAfterBb).toBe(92);
  });
});

describe("summarizeHand", () => {
  const STARTING_STACK = 100;

  it("targets preflop when no board cards are picked yet", () => {
    const summary = summarizeHand("BB", "BTN", STARTING_STACK, {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
    }, 0);
    expect(summary.targetStreet).toBe("preflop");
    expect(summary.blockedReason).toBeNull();
  });

  it("carries preflop's resulting pot/stack into the flop once it's closed", () => {
    const summary = summarizeHand(
      "BB",
      "BTN",
      STARTING_STACK,
      {
        preflop: [
          { position: "BTN", action: "raise", toBb: 3 },
          { position: "BB", action: "call" },
        ],
        flop: [],
        turn: [],
        river: [],
      },
      3,
    );
    expect(summary.targetStreet).toBe("flop");
    expect(summary.blockedReason).toBeNull();
    expect(summary.potBb).toBe(6.5); // 3 + 3 + 0.5 (SB's dead blind)
    expect(summary.effectiveStackBb).toBe(97);
    expect(summary.targetState.toAct).toBe("BB");
  });

  it("blocks moving to the turn if the flop never closed", () => {
    const summary = summarizeHand(
      "BB",
      "BTN",
      STARTING_STACK,
      {
        preflop: [
          { position: "BTN", action: "call" },
          { position: "BB", action: "check" },
        ],
        flop: [{ position: "BB", action: "bet", toBb: 2 }], // BTN hasn't responded
        turn: [],
        river: [],
      },
      4,
    );
    expect(summary.blockedReason).toMatch(/finish the flop/i);
  });

  it("blocks everything once an earlier street folded", () => {
    const summary = summarizeHand(
      "BB",
      "BTN",
      STARTING_STACK,
      {
        preflop: [
          { position: "BTN", action: "raise", toBb: 3 },
          { position: "BB", action: "fold" },
        ],
        flop: [],
        turn: [],
        river: [],
      },
      3,
    );
    expect(summary.blockedReason).toMatch(/BB folded on the preflop/i);
  });

  it("reaches the river with pot/stack carried through all three earlier streets", () => {
    const summary = summarizeHand(
      "BB",
      "BTN",
      STARTING_STACK,
      {
        preflop: [
          { position: "BTN", action: "call" },
          { position: "BB", action: "check" },
        ],
        flop: [
          { position: "BB", action: "check" },
          { position: "BTN", action: "check" },
        ],
        turn: [
          { position: "BB", action: "bet", toBb: 2 },
          { position: "BTN", action: "call" },
        ],
        river: [{ position: "BB", action: "check" }],
      },
      5,
    );
    expect(summary.targetStreet).toBe("river");
    expect(summary.blockedReason).toBeNull();
    expect(summary.potBb).toBe(6.5); // 2.5 (limped pot incl. dead SB) + 2 + 2 (turn bet/call)
    expect(summary.effectiveStackBb).toBe(97); // 99 after preflop/flop, minus the 2bb turn call
    expect(summary.targetState.toAct).toBe("BTN");
    expect(summary.targetState.isTerminal).toBe(false);
  });
});

describe("toBettingActions", () => {
  it("maps builder actions onto the schema shape, carrying size_bb only when set", () => {
    const actions: BuilderAction[] = [
      { position: "BB", action: "bet", toBb: 5 },
      { position: "BTN", action: "call" },
    ];
    expect(toBettingActions("flop", actions)).toEqual([
      { position: "BB", street: "flop", action: "bet", size_bb: 5 },
      { position: "BTN", street: "flop", action: "call" },
    ]);
  });
});

describe("preflopContext -- real blinds for any seat pair", () => {
  const call: BuilderAction = { position: "UTG", action: "call" };

  it("UTG vs BB: UTG faces the full 1bb, SB's 0.5bb is dead money", () => {
    const ctx = preflopContext("BB", "UTG", 100);
    expect(ctx.firstToAct).toBe("UTG");
    expect(ctx.potBeforeBb).toBe(0.5);

    const start = computeStreetState(ctx, []);
    expect(start.toAct).toBe("UTG");
    expect(start.facingBet).toBe(true);
    expect(start.toCallBb).toBe(1);
    expect(start.potNowBb).toBe(1.5);
  });

  it("UTG limp then BB check closes: pot 2.5, stack 99", () => {
    const ctx = preflopContext("BB", "UTG", 100);
    const afterLimp = computeStreetState(ctx, [call]);
    expect(afterLimp.isTerminal).toBe(false); // BB still has the option
    expect(afterLimp.toAct).toBe("BB");
    expect(afterLimp.facingBet).toBe(false);

    const closed = computeStreetState(ctx, [call, { position: "BB", action: "check" }]);
    expect(closed.isTerminal).toBe(true);
    expect(closed.potAfterBb).toBe(2.5);
    expect(closed.stackAfterBb).toBe(99);
  });

  it("UTG raises to 3, BB calls: pot 6.5", () => {
    const ctx = preflopContext("BB", "UTG", 100);
    const closed = computeStreetState(ctx, [
      { position: "UTG", action: "raise", toBb: 3 },
      { position: "BB", action: "call" },
    ]);
    expect(closed.isTerminal).toBe(true);
    expect(closed.potAfterBb).toBe(6.5);
    expect(closed.stackAfterBb).toBe(97);
  });

  it("BTN vs BB: BTN is no longer credited a small blind", () => {
    const ctx = preflopContext("BB", "BTN", 100);
    expect(computeStreetState(ctx, []).toCallBb).toBe(1);
    expect(ctx.potBeforeBb).toBe(0.5);
  });

  it("SB vs BB: SB acts first, completing costs 0.5, BB then has the option", () => {
    const ctx = preflopContext("SB", "BB", 100);
    expect(ctx.firstToAct).toBe("SB");
    expect(ctx.potBeforeBb).toBe(0);

    const start = computeStreetState(ctx, []);
    expect(start.toCallBb).toBe(0.5);
    const afterComplete = computeStreetState(ctx, [{ position: "SB", action: "call" }]);
    expect(afterComplete.isTerminal).toBe(false);
    expect(afterComplete.toAct).toBe("BB");
  });

  it("UTG vs BTN: both blinds are dead (1.5bb), a limp and a call close the action", () => {
    const ctx = preflopContext("UTG", "BTN", 100);
    expect(ctx.potBeforeBb).toBe(1.5);
    expect(ctx.firstToAct).toBe("UTG");
    expect(computeStreetState(ctx, []).toCallBb).toBe(1);

    const closed = computeStreetState(ctx, [
      { position: "UTG", action: "call" },
      { position: "BTN", action: "call" },
    ]);
    expect(closed.isTerminal).toBe(true);
    expect(closed.potAfterBb).toBe(3.5);
  });
});
