import type { Position, Spot } from "@poker-solver/schema";
import { POSITIONS } from "./positions";
import { buildOpenSpot, buildVsRaiseSpot } from "./spot";

// Stage 3: rule-based, two phrasings only -- matching the same two
// situations SpotBuilder's button/dropdown UI supports. See docs/plan.md's
// "Added: rule-based parser first, not LLM-first." Freeform text is
// explicitly out of scope; anything else is { kind: "unrecognized" }.
//
// Widened past the original MVP with synonyms, not new grammar: a few
// common seat names people actually type instead of the abbreviation, an
// alternate verb ("raises" as well as "opens"), and "big blinds" spelled
// out instead of "bb". Still exactly two shapes, still no free text.

const DEFAULT_STACK_BB = 100;

// Seat names people type instead of the schema's abbreviation. Multi-word
// names ("under the gun") aren't supported -- the position token is
// matched as a single \w+ word, same constraint the original MVP had.
const POSITION_ALIASES: Record<string, Position> = {
  BUTTON: "BTN",
  CUTOFF: "CO",
  HIJACK: "HJ",
};

const STACK_UNIT_RE = "(?:bb|big blinds?)";

// "BTN opens 100bb" / "UTG opens" / "CO raises 40bb" (stack optional,
// defaults to 100bb -- matching SpotBuilder's own default; "raises" as an
// alternate verb for the same unopened-pot shape -- a raise-first-in
// *is* an open).
const OPEN_RE = new RegExp(
  `^(\\w+)\\s+(?:opens?|raises?)(?:\\s+(\\d+(?:\\.\\d+)?)\\s*${STACK_UNIT_RE})?$`,
  "i",
);

// "BB defends CO's open, 100bb" / "SB vs BTN open" / "BB facing a CO raise"
const VS_RAISE_RE = new RegExp(
  `^(\\w+)\\s+(?:defends?|vs\\.?|versus|facing)\\s+(?:an?\\s+)?(\\w+)(?:'s)?` +
    `\\s+(?:opens?|raises?)(?:,?\\s+(\\d+(?:\\.\\d+)?)\\s*${STACK_UNIT_RE})?$`,
  "i",
);

export type ParseResult = { kind: "parsed"; spot: Spot } | { kind: "unrecognized" };

function toPosition(raw: string): Position | null {
  const upper = raw.toUpperCase();
  if (upper in POSITION_ALIASES) return POSITION_ALIASES[upper];
  return (POSITIONS as string[]).includes(upper) ? (upper as Position) : null;
}

/**
 * Parses one of the two supported phrasings into a Spot, via the same
 * lib/spot.ts helpers the button builder uses. Never throws: anything that
 * doesn't match one of the two patterns, or names an unrecognized position,
 * comes back as { kind: "unrecognized" }.
 */
export function parseSpotText(text: string): ParseResult {
  const trimmed = text.trim();

  const openMatch = trimmed.match(OPEN_RE);
  if (openMatch) {
    const position = toPosition(openMatch[1]);
    if (!position) return { kind: "unrecognized" };
    const stackBb = openMatch[2] ? Number(openMatch[2]) : DEFAULT_STACK_BB;
    return { kind: "parsed", spot: buildOpenSpot(position, stackBb) };
  }

  const vsRaiseMatch = trimmed.match(VS_RAISE_RE);
  if (vsRaiseMatch) {
    const position = toPosition(vsRaiseMatch[1]);
    const raiser = toPosition(vsRaiseMatch[2]);
    if (!position || !raiser) return { kind: "unrecognized" };
    const stackBb = vsRaiseMatch[3] ? Number(vsRaiseMatch[3]) : DEFAULT_STACK_BB;
    return { kind: "parsed", spot: buildVsRaiseSpot(position, raiser, stackBb) };
  }

  return { kind: "unrecognized" };
}
