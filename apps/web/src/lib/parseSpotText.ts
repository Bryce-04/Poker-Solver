import type { Position, Spot } from "@poker-solver/schema";
import { POSITIONS } from "./positions";
import { buildOpenSpot, buildVsRaiseSpot } from "./spot";

// Stage 3 MVP: rule-based, two phrasings only -- matching the same two
// situations SpotBuilder's button/dropdown UI supports. See docs/plan.md's
// "Added: rule-based parser first, not LLM-first." Freeform text is
// explicitly out of scope; anything else is { kind: "unrecognized" }.

const DEFAULT_STACK_BB = 100;

// "BTN opens 100bb" / "UTG opens" (stack optional, defaults to 100bb --
// matching SpotBuilder's own default).
const OPEN_RE = /^(\w+)\s+opens?(?:\s+(\d+(?:\.\d+)?)\s*bb)?$/i;

// "BB defends CO's open, 100bb" / "SB vs BTN open" / "BB defends against a CO open"
const VS_RAISE_RE =
  /^(\w+)\s+(?:defends?|vs\.?|versus)\s+(?:an?\s+)?(\w+)(?:'s)?\s+open(?:s)?(?:,?\s+(\d+(?:\.\d+)?)\s*bb)?$/i;

export type ParseResult = { kind: "parsed"; spot: Spot } | { kind: "unrecognized" };

function toPosition(raw: string): Position | null {
  const upper = raw.toUpperCase();
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
