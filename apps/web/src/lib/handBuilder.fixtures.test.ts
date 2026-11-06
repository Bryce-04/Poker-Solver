// The pot and stack arithmetic shared with apps/api/app/ask_coach/spot_builder.py
// (the Coach's describe_spot). The same fixtures run in
// apps/api/tests/test_ask_coach_spot_builder.py, so the two can't drift apart.
import type { Position, Street } from "@poker-solver/schema";
import fixtures from "./handBuilder.fixtures.json";
import { summarizeHand, type BuilderAction } from "./handBuilder";

interface FixtureCase {
  name: string;
  oop: Position;
  ip: Position;
  startingStackBb: number;
  boardLength: number;
  streets: Record<Street, BuilderAction[]>;
  expected: {
    targetStreet: Street;
    potBb: number;
    effectiveStackBb: number;
    blockedReason: string | null;
    toAct: Position;
    isTerminal: boolean;
    facingBet: boolean;
    toCallBb: number;
    potNowBb: number;
  };
}

const cases = fixtures.cases as FixtureCase[];

describe("handBuilder shared fixtures", () => {
  it("has enough cases to mean something", () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const s = summarizeHand(c.oop, c.ip, c.startingStackBb, c.streets, c.boardLength);
    const e = c.expected;
    expect(s.targetStreet).toBe(e.targetStreet);
    expect(s.potBb).toBeCloseTo(e.potBb, 9);
    expect(s.effectiveStackBb).toBeCloseTo(e.effectiveStackBb, 9);
    expect(s.blockedReason).toBe(e.blockedReason);
    expect(s.targetState.toAct).toBe(e.toAct);
    expect(s.targetState.isTerminal).toBe(e.isTerminal);
    expect(s.targetState.facingBet).toBe(e.facingBet);
    expect(s.targetState.toCallBb).toBeCloseTo(e.toCallBb, 9);
    expect(s.targetState.potNowBb).toBeCloseTo(e.potNowBb, 9);
  });
});
