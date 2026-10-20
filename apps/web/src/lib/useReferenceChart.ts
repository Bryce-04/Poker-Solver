import { useCallback, useRef, useState } from "react";
import type { HandRange, Spot } from "@poker-solver/schema";
import {
  fetchReferenceStrategy,
  saveSpot,
  type ReferenceStrategyResponse,
  type SpotValidationIssue,
} from "./api";
import { useAuth } from "./auth";

// The api result tags plus idle/loading. `match` carries the exact Spot that
// produced it (not the current form state) so saving saves what was actually
// matched, even if the form has been tweaked since.
export type ChartOutcome =
  | { kind: "idle" }
  // `previous`: the last chart shown, so a screen can keep it on display
  // while the next one loads instead of flashing empty.
  | { kind: "loading"; previous?: ChartMatch }
  | ChartMatch
  | { kind: "no-match" }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

export type ChartMatch = { kind: "match"; data: ReferenceStrategyResponse; spot: Spot };

export type ChartSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error" }
  | { kind: "not-signed-in" };

/** The hero's range from a matched chart (the seat the spot is about). */
export function chartRangeFor(data: ReferenceStrategyResponse, spot: Spot): HandRange {
  return data.ranges[spot.positions_in_hand[0]] ?? {};
}

/** Same hands at the same weights, ignoring zero-weight entries. */
export function sameRange(a: HandRange, b: HandRange): boolean {
  const live = (r: HandRange) => Object.entries(r).filter(([, w]) => w > 0);
  const liveA = live(a);
  return liveA.length === live(b).length && liveA.every(([hand, w]) => b[hand] === w);
}

/**
 * Fetch a spot's reference chart, keep an editable copy of its range, and save
 * that copy -- the logic every preflop-chart entry path shares (the phone
 * Builder / Type in / Import pages and the desktop Ranges page).
 *
 * `load` can be called on every keystroke or click: only the latest call's
 * response is applied, so an older, slower response can't overwrite a newer
 * spot's chart.
 */
export function useReferenceChart() {
  const auth = useAuth();
  const [outcome, setOutcome] = useState<ChartOutcome>({ kind: "idle" });
  const [saveState, setSaveState] = useState<ChartSaveState>({ kind: "idle" });
  // The chart's range, editable before saving. Re-seeded from the chart every
  // time a fresh match comes in; RangeGrid owns no range state itself.
  const [editedRange, setEditedRange] = useState<HandRange>({});
  const latest = useRef(0);

  // Stable identities (no deps beyond setters and a ref), so a page can call
  // these from an effect without re-running it every render.
  const load = useCallback(async (spot: Spot) => {
    const request = ++latest.current;
    setOutcome((prev) => ({
      kind: "loading",
      previous: prev.kind === "match" ? prev : prev.kind === "loading" ? prev.previous : undefined,
    }));
    setSaveState({ kind: "idle" });
    const result = await fetchReferenceStrategy(spot);
    if (request !== latest.current) return;
    if (result.kind === "match") {
      setOutcome({ kind: "match", data: result.data, spot });
      setEditedRange(chartRangeFor(result.data, spot));
    } else {
      setOutcome(result);
    }
  }, []);

  /** Back to idle, dropping any in-flight response. */
  const clear = useCallback(() => {
    latest.current++;
    setOutcome({ kind: "idle" });
    setSaveState({ kind: "idle" });
  }, []);

  function resetToChart() {
    if (outcome.kind === "match") setEditedRange(chartRangeFor(outcome.data, outcome.spot));
  }

  /** Save the matched spot with the range as edited, not the untouched chart. */
  async function save() {
    if (outcome.kind !== "match") return;
    if (auth.status !== "signed-in") {
      setSaveState({ kind: "not-signed-in" });
      return;
    }
    setSaveState({ kind: "saving" });
    const { spot } = outcome;
    const result = await saveSpot({ ...spot, ranges: { [spot.positions_in_hand[0]]: editedRange } });
    setSaveState(result.kind === "saved" ? { kind: "saved" } : { kind: "error" });
  }

  const edited =
    outcome.kind === "match" && !sameRange(chartRangeFor(outcome.data, outcome.spot), editedRange);

  return { outcome, saveState, editedRange, setEditedRange, edited, load, clear, resetToChart, save };
}
