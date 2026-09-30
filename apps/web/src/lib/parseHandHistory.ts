import type { Position, Spot } from "@poker-solver/schema";
import { buildOpenSpot, buildVsRaiseSpot } from "./spot";

/**
 * Stage 4 MVP: reconstructs a Spot from a pasted hand history. One format
 * (a PokerStars-style export), one table size (a full 6-handed 6-max
 * table -- matching Stage 2/3's own scope, see
 * docs/reference-chart-coverage.md), and only hands that reduce to one of
 * the two shapes buildOpenSpot/buildVsRaiseSpot can represent: unopened
 * (folds to hero) or hero facing exactly one uncontested raise. Anything
 * else -- multiple raises, a limp/call before hero, postflop action --
 * comes back `unrecognized` with a specific reason, same honest-refusal
 * convention as lib/parseSpotText.ts (which this mirrors for the "how a
 * parser here behaves" shape, not the regex approach -- a multi-line
 * paste has enough structure to explain *why* it didn't parse, unlike a
 * short typed phrase).
 *
 * Deliberately narrow per docs/plan.md's Stage 4 note: "scoped to one or
 * two concrete formats first, with pluggable adapters for more later."
 * This is the one adapter; a second site's format is a second module,
 * not a rewrite of this one.
 */

export type HandHistoryParseResult =
  | { kind: "parsed"; spot: Spot }
  | { kind: "unrecognized"; reason: string };

const TABLE_HEADER_RE = /(\d+)-max.*Seat #(\d+) is the button/i;
const BLINDS_RE = /\(\$?([\d.]+)\/\$?([\d.]+)/;
const SEAT_RE = /^Seat (\d+): (\S+) \(\$?([\d.]+) in chips\)/gm;
const HOLE_CARDS_MARKER = "*** HOLE CARDS ***";
const RAISE_RE = /^(\S+): raises/;
const CALL_OR_CHECK_RE = /^\S+: (calls|checks|bets)/;
const HERO_ACTS_RE = /^Hero: /;

// 6-max seats in clockwise order starting from the button -- offset 0 is
// the button itself, matching how a hand history numbers "is the button."
const CLOCKWISE_FROM_BUTTON: Position[] = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];

export function parseHandHistory(text: string): HandHistoryParseResult {
  const headerMatch = text.match(TABLE_HEADER_RE);
  if (!headerMatch) {
    return {
      kind: "unrecognized",
      reason:
        'Couldn\'t find a table size and button seat -- looking for a line like "6-max ... Seat #4 is the button".',
    };
  }
  const tableSize = Number(headerMatch[1]);
  const buttonSeat = Number(headerMatch[2]);
  if (tableSize !== 6) {
    return { kind: "unrecognized", reason: "Only 6-max hands are supported right now." };
  }

  const blindsMatch = text.match(BLINDS_RE);
  if (!blindsMatch) {
    return {
      kind: "unrecognized",
      reason: 'Couldn\'t find the blind levels -- looking for something like "($0.50/$1.00".',
    };
  }
  const bigBlind = Number(blindsMatch[2]);

  const seats = new Map<number, { name: string; stack: number }>();
  for (const m of text.matchAll(SEAT_RE)) {
    seats.set(Number(m[1]), { name: m[2], stack: Number(m[3]) });
  }
  if (seats.size !== 6) {
    return {
      kind: "unrecognized",
      reason: `Found ${seats.size} seated player(s), need all 6 for a 6-max hand.`,
    };
  }

  const heroEntry = [...seats].find(([, s]) => s.name === "Hero");
  if (!heroEntry) {
    return {
      kind: "unrecognized",
      reason: 'Couldn\'t find Hero\'s seat -- name the hero seat literally "Hero" in the pasted hand.',
    };
  }
  const [heroSeat, hero] = heroEntry;

  function positionOf(seat: number): Position {
    const offset = (seat - buttonSeat + tableSize) % tableSize;
    return CLOCKWISE_FROM_BUTTON[offset];
  }
  const nameToPosition = new Map([...seats].map(([seat, s]) => [s.name, positionOf(seat)]));

  const holeCardsIdx = text.indexOf(HOLE_CARDS_MARKER);
  if (holeCardsIdx === -1) {
    return { kind: "unrecognized", reason: 'Couldn\'t find the "*** HOLE CARDS ***" marker.' };
  }
  const actionLines = text
    .slice(holeCardsIdx + HOLE_CARDS_MARKER.length)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let raiser: Position | null = null;
  for (const line of actionLines) {
    if (HERO_ACTS_RE.test(line)) break;

    const raiseMatch = line.match(RAISE_RE);
    if (raiseMatch) {
      if (raiser !== null) {
        return {
          kind: "unrecognized",
          reason: "More than one raise before your turn -- reference charts only cover a single raise.",
        };
      }
      const pos = nameToPosition.get(raiseMatch[1]);
      if (!pos) {
        return {
          kind: "unrecognized",
          reason: `"${raiseMatch[1]}" raised but isn't one of the seated players.`,
        };
      }
      raiser = pos;
      continue;
    }

    if (CALL_OR_CHECK_RE.test(line)) {
      return {
        kind: "unrecognized",
        reason:
          "There's a call, check, or bet before your turn -- reference charts only cover folds to a single raise.",
      };
    }
    // Folds fall through and are ignored -- same convention as
    // lib/spot.ts's builders, which don't record folded seats either.
  }

  const heroPosition = positionOf(heroSeat);
  const stackBb = hero.stack / bigBlind;

  const spot = raiser
    ? buildVsRaiseSpot(heroPosition, raiser, stackBb)
    : buildOpenSpot(heroPosition, stackBb);
  return { kind: "parsed", spot };
}
