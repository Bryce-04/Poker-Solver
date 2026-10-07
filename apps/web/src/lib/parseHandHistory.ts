import type { Position, Spot } from "@poker-solver/schema";
import { buildOpenSpot, buildVsRaiseSpot } from "./spot";

/**
 * Stage 4: reconstructs state from a pasted hand history. One format (a
 * PokerStars-style export), one table size (a full 6-handed 6-max table --
 * matching Stage 2/3's own scope, see docs/reference-chart-coverage.md).
 * Two entry points sharing the same header/seat parsing (parseHeaderAndSeats
 * below), for two different jobs:
 *
 *   - parseHandHistory: the original MVP. Only hands that reduce to one of
 *     the two shapes buildOpenSpot/buildVsRaiseSpot can represent --
 *     unopened (folds to hero) or hero facing exactly one uncontested raise,
 *     stopping at Hero's first action. Feeds ImportPage's preflop-chart
 *     lookup, unchanged.
 *   - parseHandHistoryToPostflopSetup: fast-forwards through every street
 *     present in the paste (not just preflop) and hands back whatever
 *     SolvePage needs to start solving from that exact point -- board, pot,
 *     effective stack, who's OOP/IP, whether OOP has already checked this
 *     street. Deliberately does NOT return ranges (a hand history doesn't
 *     reveal villain's actual holdings) -- see docs/decisions.md's entry on
 *     why this is reading recorded history, not solving/computing earlier
 *     streets, which is what makes it a cheap addition rather than the
 *     combinatorial-blowup problem real multi-street solving would be.
 *
 * Both are honest-refusal parsers, same convention as lib/parseSpotText.ts:
 * anything that doesn't fit cleanly comes back `unrecognized` with a
 * specific reason rather than a guess. Deliberately narrow per
 * docs/plan.md's Stage 4 note: "scoped to one or two concrete formats
 * first, with pluggable adapters for more later." This is the one adapter;
 * a second site's format is a second module, not a rewrite of this one.
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

interface ParsedHeader {
  bigBlind: number;
  seats: Map<number, { name: string; stack: number }>;
  heroSeat: number;
  hero: { name: string; stack: number };
  positionOf: (seat: number) => Position;
  nameToPosition: Map<string, Position>;
}

type ParsedHeaderResult = { kind: "ok"; header: ParsedHeader } | { kind: "unrecognized"; reason: string };

/** Table size/button/blinds/seats/Hero parsing shared by both entry
 * points below -- the part of a hand history that's always the same
 * regardless of which job the rest of the parse is doing. */
function parseHeaderAndSeats(text: string): ParsedHeaderResult {
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

  return { kind: "ok", header: { bigBlind, seats, heroSeat, hero, positionOf, nameToPosition } };
}

export function parseHandHistory(text: string): HandHistoryParseResult {
  const headerResult = parseHeaderAndSeats(text);
  if (headerResult.kind === "unrecognized") return headerResult;
  const { bigBlind, heroSeat, hero, positionOf, nameToPosition } = headerResult.header;

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

// --- parseHandHistoryToPostflopSetup ---

export interface PostflopSetup {
  oopPosition: Position;
  ipPosition: Position;
  effectiveStackBb: number;
  potBb: number;
  /** 3-5 cards, schema casing ("Ks", "9d") -- however far the paste goes. */
  board: string[];
  oopAlreadyChecked: boolean;
}

export type HandHistoryToSetupResult =
  | { kind: "ok"; setup: PostflopSetup }
  | { kind: "unrecognized"; reason: string };

const POST_RE = /^(\S+): posts (?:small blind|big blind|the ante) \$?([\d.]+)/gm;
const STREET_MARKER_RE = /^\*\*\* (FLOP|TURN|RIVER) \*\*\*/;
const FLOP_BOARD_RE = /\*\*\* FLOP \*\*\* \[([^\]]+)\]/;
const TURN_CARD_RE = /\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/;
const RIVER_CARD_RE = /\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/;
// name, verb, then an optional "$amount" and/or "to $amount" -- covers
// "folds" / "checks" / "calls $5" / "bets $10" / "raises $5 to $15" (the
// "to" amount is the raiser's new total this street, not an increment).
// Trailing text like " and is all-in" is simply not matched, not rejected.
const ACTION_RE = /^(\S+): (folds|checks|calls|bets|raises)(?:\s\$?([\d.]+))?(?:\sto\s\$?([\d.]+))?/;

const STREET_CARD_COUNT: Record<"flop" | "turn" | "river", number> = { flop: 3, turn: 4, river: 5 };

// Standard postflop action order (button acts last) -- whichever of the
// two still-live positions comes first here is out of position.
const POSTFLOP_ORDER: Position[] = ["SB", "BB", "UTG", "HJ", "CO", "BTN"];

function normalizeCard(raw: string): string {
  return raw[0].toUpperCase() + raw[1].toLowerCase();
}

export function parseHandHistoryToPostflopSetup(text: string): HandHistoryToSetupResult {
  const headerResult = parseHeaderAndSeats(text);
  if (headerResult.kind === "unrecognized") return headerResult;
  const { bigBlind, seats, positionOf, nameToPosition } = headerResult.header;

  const positionToStack = new Map(
    [...seats].map(([seat, s]) => [positionOf(seat), s.stack]),
  );

  const holeCardsIdx = text.indexOf(HOLE_CARDS_MARKER);
  if (holeCardsIdx === -1) {
    return { kind: "unrecognized", reason: 'Couldn\'t find the "*** HOLE CARDS ***" marker.' };
  }

  const folded = new Set<Position>();
  const totalContributed = new Map<Position, number>([...nameToPosition.values()].map((p) => [p, 0]));
  let contributedThisStreet = new Map<Position, number>(
    [...nameToPosition.values()].map((p) => [p, 0]),
  );
  let potTotal = 0;

  // Blinds/antes are posted before "*** HOLE CARDS ***" -- scan the whole
  // text for them, not just the slice after it.
  for (const m of text.matchAll(POST_RE)) {
    const pos = nameToPosition.get(m[1]);
    if (pos) contributedThisStreet.set(pos, (contributedThisStreet.get(pos) ?? 0) + Number(m[2]));
  }

  function finalizeStreet() {
    for (const [pos, amt] of contributedThisStreet) {
      potTotal += amt;
      totalContributed.set(pos, (totalContributed.get(pos) ?? 0) + amt);
    }
    contributedThisStreet = new Map([...nameToPosition.values()].map((p) => [p, 0]));
  }

  let currentStreet: "preflop" | "flop" | "turn" | "river" = "preflop";
  let board: string[] = [];
  let currentStreetActions: { position: Position; action: "fold" | "check" | "acted" }[] = [];

  const lines = text
    .slice(holeCardsIdx + HOLE_CARDS_MARKER.length)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const streetMatch = line.match(STREET_MARKER_RE);
    if (streetMatch) {
      finalizeStreet();
      currentStreetActions = [];
      const label = streetMatch[1].toLowerCase() as "flop" | "turn" | "river";
      currentStreet = label;
      if (label === "flop") {
        const m = line.match(FLOP_BOARD_RE);
        if (m) board = m[1].trim().split(/\s+/).map(normalizeCard);
      } else if (label === "turn") {
        const m = line.match(TURN_CARD_RE);
        if (m) board = [...board, normalizeCard(m[1].trim())];
      } else {
        const m = line.match(RIVER_CARD_RE);
        if (m) board = [...board, normalizeCard(m[1].trim())];
      }
      continue;
    }

    const actionMatch = line.match(ACTION_RE);
    if (!actionMatch) continue; // summary/collected/shows lines etc. -- not relevant
    const [, name, verb, amt1, amt2] = actionMatch;
    const pos = nameToPosition.get(name);
    if (!pos) continue;

    if (verb === "folds") {
      folded.add(pos);
      currentStreetActions.push({ position: pos, action: "fold" });
    } else if (verb === "checks") {
      currentStreetActions.push({ position: pos, action: "check" });
    } else if (verb === "calls" || verb === "bets") {
      contributedThisStreet.set(pos, (contributedThisStreet.get(pos) ?? 0) + Number(amt1 ?? 0));
      currentStreetActions.push({ position: pos, action: "acted" });
    } else if (verb === "raises") {
      contributedThisStreet.set(pos, Number(amt2 ?? amt1 ?? 0));
      currentStreetActions.push({ position: pos, action: "acted" });
    }
  }
  finalizeStreet();

  if (currentStreet === "preflop") {
    return {
      kind: "unrecognized",
      reason:
        "This hand never reaches the flop -- paste a hand that's gone postflop, or use Type In / the button builder for a preflop spot.",
    };
  }

  const expectedCards = STREET_CARD_COUNT[currentStreet];
  if (board.length !== expectedCards) {
    return {
      kind: "unrecognized",
      reason: `Couldn't read the board cards for the ${currentStreet}.`,
    };
  }

  const live = [...nameToPosition.values()].filter((p) => !folded.has(p));
  if (live.length !== 2) {
    return {
      kind: "unrecognized",
      reason: `${live.length} players are still in the hand at this point -- this solver is heads-up only, so exactly 2 need to be left.`,
    };
  }

  const oopPosition = POSTFLOP_ORDER.find((p) => live.includes(p));
  const ipPosition = live.find((p) => p !== oopPosition);
  if (!oopPosition || !ipPosition) {
    return { kind: "unrecognized", reason: "Couldn't determine who's out of position." };
  }

  const validTarget =
    currentStreetActions.length === 0 ||
    (currentStreetActions.length === 1 &&
      currentStreetActions[0].action === "check" &&
      currentStreetActions[0].position === oopPosition);
  if (!validTarget) {
    return {
      kind: "unrecognized",
      reason:
        "There's already betting action on this street -- paste only up through the point just before the decision you want to look at, not past it.",
    };
  }

  const stackA = positionToStack.get(oopPosition) ?? 0;
  const stackB = positionToStack.get(ipPosition) ?? 0;
  const remainingA = stackA - (totalContributed.get(oopPosition) ?? 0);
  const remainingB = stackB - (totalContributed.get(ipPosition) ?? 0);
  const effectiveStackBb = Math.min(remainingA, remainingB) / bigBlind;

  return {
    kind: "ok",
    setup: {
      oopPosition,
      ipPosition,
      effectiveStackBb,
      potBb: potTotal / bigBlind,
      board,
      oopAlreadyChecked: currentStreetActions.length === 1,
    },
  };
}
