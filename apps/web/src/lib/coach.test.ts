import { describe, expect, it } from "vitest";
import deckFile from "../data/drill-deck.json";
import { drillCoachContext, suggestedQuestions } from "./coach";
import type { DrillDeckFile, DrillSpot } from "./drill";

const SPOTS = (deckFile as unknown as DrillDeckFile).decks[0].spots;
const byKind = (kind: DrillSpot["situation"]) => SPOTS.find((s) => s.situation === kind)!;
const top = (spot: DrillSpot) => [...spot.actions].sort((a, b) => (spot.mix[b] ?? 0) - (spot.mix[a] ?? 0))[0];

describe("drillCoachContext", () => {
  it("describes the seat, pot and stacks for a first-to-act spot", () => {
    const spot = byKind("first_to_act");
    const ctx = drillCoachContext(spot, spot.actions[0], "bb");
    expect(ctx.lesson_title).toBe("Poker Drill");
    expect(ctx.prompt).toContain(`You are ${spot.heroPosition}, out of position`);
    expect(ctx.prompt).toContain("act first");
    expect(ctx.board).toEqual(spot.board);
    expect(ctx.hand).toEqual([...spot.hand]);
  });

  it("says what bet the hero is facing", () => {
    const spot = byKind("facing_bet");
    expect(drillCoachContext(spot, "fold", "bb").prompt).toMatch(/bet \d+(\.\d)?bb into you/);
  });

  it("names the pick and the solver's favourite, and puts the whole mix in the facts", () => {
    const spot = byKind("first_to_act");
    const ctx = drillCoachContext(spot, "check", "pct");
    expect(ctx.picked).toBe("Check");
    expect(ctx.correct).toMatch(/most frequent action/);
    expect(ctx.details).toMatch(/^The solver's mix for this exact hand: /);
    expect(ctx.details).toContain(`Check: ${Math.round((spot.mix["check"] ?? 0) * 100)}%`);
    expect(ctx.explanation).not.toMatch(/solver's mix/); // the bars already show it
  });

  it("passes on the computed analysis and nothing else", () => {
    const spot = SPOTS.find((s) => s.analysis)!;
    const ctx = drillCoachContext(spot, spot.actions[0], "bb");
    for (const bullet of spot.analysis!.bullets) expect(ctx.details).toContain(bullet);
    expect(ctx.details).toContain(`${spot.analysis!.facts.equityPct}% equity`);
  });

  it("stays inside the server's size limits for every spot in the deck", () => {
    for (const spot of SPOTS) {
      for (const a of spot.actions) {
        const ctx = drillCoachContext(spot, a, "bb");
        expect(ctx.prompt.length).toBeLessThanOrEqual(400);
        expect(ctx.picked.length).toBeLessThanOrEqual(120);
        expect(ctx.correct.length).toBeLessThanOrEqual(120);
        expect(ctx.explanation.length).toBeLessThanOrEqual(1500);
        expect((ctx.details ?? "").length).toBeLessThanOrEqual(1500);
      }
    }
  });

  it("works for a spot with no analysis", () => {
    const { analysis: _drop, ...bare } = SPOTS[0];
    const ctx = drillCoachContext(bare as DrillSpot, bare.actions[0], "bb");
    expect(ctx.explanation).toMatch(/^The solver plays /);
    expect(ctx.details).toMatch(/^The solver's mix/);
  });

  it("keeps what you read if the AI can't answer short: two sentences, not the whole analysis", () => {
    const spot = SPOTS.find((s) => s.analysis && s.analysis.bullets.length >= 4)!;
    const ctx = drillCoachContext(spot, spot.actions[0], "bb");
    expect(ctx.explanation).toBe(`${spot.analysis!.bullets[0]} ${spot.analysis!.bullets[2]}`);
    expect(ctx.explanation.length).toBeLessThan(spot.analysis!.bullets.join(" ").length);
  });
});

describe("suggestedQuestions", () => {
  it("asks whether your pick was a mistake only when it wasn't the solver's favourite", () => {
    const spot = SPOTS[0];
    const other = spot.actions.find((a) => a !== top(spot))!;
    expect(suggestedQuestions(spot, other, "bb").some((q) => /really a mistake/.test(q))).toBe(true);
    expect(suggestedQuestions(spot, top(spot), "bb").some((q) => /really a mistake/.test(q))).toBe(false);
  });

  it("gives between one and three for every spot", () => {
    for (const spot of SPOTS) {
      const qs = suggestedQuestions(spot, spot.actions[0], "bb");
      expect(qs.length).toBeGreaterThan(0);
      expect(qs.length).toBeLessThanOrEqual(3);
    }
  });
});
