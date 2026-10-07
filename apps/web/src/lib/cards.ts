// Board-card text parsing for the Solve screen (lib/positions.ts's sibling
// for cards instead of seats). Nothing in the frontend has needed a board
// before now -- everything shipped so far (Stages 2-4) is preflop-only.
// This is a v1: a validated text field ("Ks Qh 9d"), not a visual rank/
// suit picker -- see docs/decisions.md's 2026-10-06 entry.

import type { Spot } from "@poker-solver/schema";

// Spot["board"] rather than importing the generated Board type directly --
// generated/index.ts only re-exports the types consumers have needed so
// far, and Board hasn't been one of them until now. NonNullable because
// `board` has a Pydantic default (so json-schema-to-typescript marks it
// optional on Spot), not because a board can actually be omitted here.
type Board = NonNullable<Spot["board"]>;

const CARD_RE = /^([2-9TJQKA])([SHDC])$/i;

export type ParseBoardResult =
  | { kind: "ok"; cards: Board }
  | { kind: "error"; reason: string };

/**
 * Parses space-separated card tokens (e.g. "Ks Qh 9d") into the schema's
 * board shape: a list of "RrSs"-cased two-char strings (rank uppercase,
 * suit lowercase), matching packages/schema's CARD_PATTERN. Requires
 * exactly 3 (flop), 4 (turn), or 5 (river) cards -- this route only ever
 * solves a single already-dealt postflop street, never preflop.
 */
export function parseBoardText(text: string): ParseBoardResult {
  const tokens = text.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return { kind: "error", reason: "Enter a board -- e.g. \"Ks Qh 9d\"." };
  }
  if (tokens.length < 3 || tokens.length > 5) {
    return {
      kind: "error",
      reason: `A board is 3 (flop), 4 (turn), or 5 (river) cards -- got ${tokens.length}.`,
    };
  }

  const cards: string[] = [];
  for (const token of tokens) {
    const match = CARD_RE.exec(token);
    if (!match) {
      return { kind: "error", reason: `"${token}" isn't a card -- use rank+suit, e.g. "Kh".` };
    }
    cards.push(match[1].toUpperCase() + match[2].toLowerCase());
  }

  const seen = new Set(cards);
  if (seen.size !== cards.length) {
    return { kind: "error", reason: "The board has a repeated card." };
  }

  // Length is already validated above (3-5) -- Board's type is a tuple
  // union keyed on length, which plain string[] construction can't prove
  // to the type checker on its own.
  return { kind: "ok", cards: cards as Board };
}
