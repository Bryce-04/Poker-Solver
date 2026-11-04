import { useEffect, useState } from "react";
import type { HandRange, Position, Spot } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS } from "./positions";
import { buildOpenSpot, buildVsRaiseSpot } from "./spot";
import type { useReferenceChart } from "./useReferenceChart";

// The Ranges screen's spot logic, shared by the desktop workspace
// (pages/RangesWorkspace.tsx) and the phone page (pages/ranges/RangesPhone.tsx):
// what Pick's controls describe, the chart's title, and loading the chart as
// the spot changes.

export type Situation = "open" | "defend";

export const TYPE_EXAMPLES = ["BTN opens 100bb", "BB defends CO open, 100bb", "CO opens 40bb"];

export const TOTAL_COMBOS = 1326;

// How long Pick / Type it wait after the last change before fetching, so
// clicking through seats or typing doesn't fire a request per keystroke.
const AUTO_LOAD_MS = 250;

/** The seats that act before `seat` preflop, so could have raised first. */
export function earlierSeats(seat: Position): Position[] {
  return SIX_MAX_POSITIONS.slice(0, SIX_MAX_POSITIONS.indexOf(seat));
}

/** The raiser in a chart spot (open, or facing one raise). */
export function raiserOf(spot: Spot): Position | undefined {
  return (spot.actions ?? []).find((a) => a.action === "raise")?.position;
}

/** The Pick controls' spot, with the impossible combinations derived away:
 * BB is never first in, UTG never faces an earlier raise, and the raiser
 * must act before the seat. */
export function pickSpot(seat: Position, situationChoice: Situation, raiserChoice: Position, stackBb: number) {
  const situation: Situation = seat === "BB" ? "defend" : seat === "UTG" ? "open" : situationChoice;
  const raisers = earlierSeats(seat);
  const raiser = raisers.includes(raiserChoice) ? raiserChoice : raisers[raisers.length - 1];
  const spot = situation === "defend" ? buildVsRaiseSpot(seat, raiser, stackBb) : buildOpenSpot(seat, stackBb);
  return { situation, raisers, raiser, spot };
}

/** A chart spot in words: the chart's title and the line under it. */
export function describeSpot(spot: Spot): { title: string; subline: string } {
  const hero = spot.positions_in_hand[0];
  const raiser = raiserOf(spot);
  const stack = `about ${spot.effective_stack_bb}bb`;
  return raiser
    ? {
        title: `${hero} vs a ${raiser} raise`,
        subline: `${raiser} raised and it's on you · ${stack} · 6-max. Green hands continue (call or 3-bet); the rest fold.`,
      }
    : { title: `${hero} opening range`, subline: `Nobody has raised yet · ${stack} · 6-max` };
}

/** A saved chart opened from the Library, recognized by the spot Pick builds
 * from it: whenever Pick is back on it, its saved range and name come back. */
export interface OpenedChart {
  key: string;
  range: HandRange;
  name: string | null;
}

/** Pick's starting choices for an opened chart (or the defaults), and the
 * opened chart itself. Read once, when the page mounts. */
export function useOpenedChart(initialSpot: Spot | undefined) {
  const openedRaiser = initialSpot ? raiserOf(initialSpot) : undefined;
  const [opened] = useState<OpenedChart | null>(() => {
    if (!initialSpot) return null;
    const hero = initialSpot.positions_in_hand[0];
    const { spot: built } = pickSpot(hero, openedRaiser ? "defend" : "open", openedRaiser ?? "CO", initialSpot.effective_stack_bb);
    return { key: JSON.stringify(built), range: initialSpot.ranges?.[hero] ?? {}, name: initialSpot.name ?? null };
  });
  const defaults = {
    seat: (initialSpot?.positions_in_hand[0] ?? "BTN") as Position,
    situation: (openedRaiser ? "defend" : "open") as Situation,
    raiser: (openedRaiser ?? "CO") as Position,
    stackBb: initialSpot?.effective_stack_bb ?? 100,
  };
  return { opened, defaults };
}

/**
 * Load the chart whenever the described spot changes (debounced; stale
 * responses are dropped by useReferenceChart), or clear it when there's no
 * spot. An opened chart's saved range shows instead of the standard one.
 */
export function useChartAutoLoad(
  spot: Spot | null,
  chart: Pick<ReturnType<typeof useReferenceChart>, "load" | "clear">,
  opened: OpenedChart | null,
) {
  const { load, clear } = chart;
  // Keyed on the spot's content, since a fresh object is built every render.
  const spotKey = spot ? JSON.stringify(spot) : null;
  useEffect(() => {
    if (spotKey === null) {
      clear();
      return;
    }
    const startRange = opened && spotKey === opened.key ? opened.range : undefined;
    const timer = setTimeout(() => load(JSON.parse(spotKey) as Spot, startRange), AUTO_LOAD_MS);
    return () => clearTimeout(timer);
  }, [spotKey, load, clear, opened]);
}
