import { boardFromCards, parseBoardText } from "./cards";

describe("parseBoardText", () => {
  it("parses a flop (3 cards)", () => {
    expect(parseBoardText("Ks Qh 9d")).toEqual({ kind: "ok", cards: ["Ks", "Qh", "9d"] });
  });

  it("parses a turn (4 cards)", () => {
    expect(parseBoardText("Ks Qh 9d 4c")).toEqual({
      kind: "ok",
      cards: ["Ks", "Qh", "9d", "4c"],
    });
  });

  it("parses a river (5 cards)", () => {
    expect(parseBoardText("Ks Qh 9d 4c 2s")).toEqual({
      kind: "ok",
      cards: ["Ks", "Qh", "9d", "4c", "2s"],
    });
  });

  it("normalizes case and tolerates extra whitespace", () => {
    expect(parseBoardText("  ks  QH 9D  ")).toEqual({
      kind: "ok",
      cards: ["Ks", "Qh", "9d"],
    });
  });

  it("rejects too few cards", () => {
    const result = parseBoardText("Ks Qh");
    expect(result.kind).toBe("error");
    expect((result as { reason: string }).reason).toMatch(/3 \(flop\)/);
  });

  it("rejects too many cards", () => {
    const result = parseBoardText("Ks Qh 9d 4c 2s 7h");
    expect(result.kind).toBe("error");
  });

  it("rejects an empty board", () => {
    const result = parseBoardText("   ");
    expect(result.kind).toBe("error");
  });

  it("rejects an invalid token", () => {
    const result = parseBoardText("Zz Qh 9d");
    expect(result.kind).toBe("error");
    expect((result as { reason: string }).reason).toMatch(/"Zz"/);
  });

  it("rejects a repeated card", () => {
    const result = parseBoardText("Ks Ks 9d");
    expect(result.kind).toBe("error");
    expect((result as { reason: string }).reason).toMatch(/repeated/);
  });
});

describe("boardFromCards", () => {
  it("accepts 3-5 picked cards as-is", () => {
    expect(boardFromCards(["Ks", "Qh", "9d"])).toEqual({
      kind: "ok",
      cards: ["Ks", "Qh", "9d"],
    });
  });

  it("rejects fewer than 3 cards", () => {
    expect(boardFromCards(["Ks", "Qh"]).kind).toBe("error");
  });

  it("rejects more than 5 cards", () => {
    expect(boardFromCards(["Ks", "Qh", "9d", "4c", "2s", "7h"]).kind).toBe("error");
  });
});
