import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { assignPostflopSeats } from "../../lib/positions";
import { boardFromCards, parseBoardText } from "../../lib/cards";
import { buildOpenSpot, buildVsRaiseSpot } from "../../lib/spot";
import { parseHandHistoryToPostflopSetup } from "../../lib/parseHandHistory";
import {
  STREET_ORDER,
  computeStreetState,
  preflopContext,
  summarizeHand,
  toBettingActions,
} from "../../lib/handBuilder";
import type { BuilderAction } from "../../lib/handBuilder";
import { fetchPreflopRanges, fetchReferenceStrategy, narrowRanges, solveSpot, type LiveSolveResponse, type SpotValidationIssue } from "../../lib/api";
import { seedFromSpot, type SolvePrefill } from "../../lib/solvePrefill";
import { boardText as cardsInWords } from "../../lib/spotText";
import { buildNarrowSpot, describeStreets, streetsToNarrow, unlikelyLineWarning } from "../../lib/chaining";

export type BoardMode = "pick" | "text";
export type SetupMode = "click" | "paste";

export type Outcome =
  | { kind: "idle" }
  | { kind: "loading" }
  // `range` is the deciding player's range as it was when solved, so the
  // result can fade hands that are barely in it (later edits don't move it).
  // `elapsedMs`: how long the solve took, measured here (desktop's accuracy
  // card). `spot`: exactly what was solved, for its summary.
  | { kind: "solved"; data: LiveSolveResponse; range: HandRange; elapsedMs: number; spot: Spot }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "rejected"; reason: string }
  | { kind: "busy" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

export type PreflopLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; description: string }
  | { kind: "unavailable"; reason: string };

export type NarrowState =
  | { kind: "idle" }
  | { kind: "loading"; street: string }
  | { kind: "done"; streets: string; trimmedNote: string }
  | { kind: "failed"; reason: string };

// Status for each position's "Load reference range" button -- separate
// from the solve Outcome above, since loading a starting range and
// submitting a solve are independent actions with independent feedback.
export type ChartLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded" }
  | { kind: "unavailable"; reason: string };

function narrowFailureReason(
  result: Exclude<Awaited<ReturnType<typeof narrowRanges>>, { kind: "narrowed" }>,
  street: string,
): string {
  switch (result.kind) {
    case "unsupported":
      return "The server doesn't support narrowing yet (it needs the newest version) -- set the range by hand.";
    case "rejected":
      return `Couldn't narrow by the ${street}: ${result.reason}`;
    case "invalid":
      return `The server rejected the ${street} spot.`;
    case "busy":
      return "The solver is busy with another solve -- try again in a minute.";
    case "network-error":
      return "Couldn't reach the API. Check your connection and try again.";
    case "error":
      return `Narrowing failed: the request returned HTTP ${result.status}.`;
  }
}

function streetForBoardLength(length: number): Street {
  if (length === 3) return "flop";
  if (length === 4) return "turn";
  return "river";
}

const EMPTY_STREETS: Record<Street, BuilderAction[]> = {
  preflop: [],
  flop: [],
  turn: [],
  river: [],
};

/**
 * All of the Solve screen's state, what's derived from it, and its actions --
 * shared by both layouts: the phone page (SolvePage.tsx, unchanged markup)
 * and the desktop workspace (SolveWorkspace.tsx). Lives in SolvePage, so
 * crossing the 1024px breakpoint keeps a half-built spot.
 */
export function useSolveSetup(prefill?: SolvePrefill, savedSpot?: Spot) {
  // A spot opened from the Library seeds the whole setup (read on mount).
  const [seed] = useState(() => (savedSpot ? seedFromSpot(savedSpot) : null));
  const [setupMode, setSetupMode] = useState<SetupMode>(seed?.setupMode ?? "click");
  // The two heads-up seats, in whichever order they were picked -- who is
  // out of position / in position is derived from them, never chosen.
  // `prefill` (another screen's "solve from here") seeds them, one range and
  // the stack; it's only read on mount.
  const [seatA, setSeatA] = useState<Position>(seed?.seatA ?? prefill?.hero ?? "BB");
  const [seatB, setSeatB] = useState<Position>(seed?.seatB ?? prefill?.villain ?? "BTN");
  const { oop: oopPosition, ip: ipPosition } = assignPostflopSeats(seatA, seatB);
  const [boardMode, setBoardMode] = useState<BoardMode>("pick");
  const [boardText, setBoardText] = useState("");
  const [pickedCards, setPickedCards] = useState<string[]>(seed?.pickedCards ?? []);
  // Ranges and "Load typical range" status are kept per SEAT, not per role,
  // so changing the other player never leaves a range on the wrong player.
  const [ranges, setRanges] = useState<Partial<Record<Position, HandRange>>>(() =>
    seed ? seed.ranges : prefill ? { [prefill.hero]: prefill.heroRange } : {},
  );
  const [chartStates, setChartStates] = useState<Partial<Record<Position, ChartLoadState>>>({});
  // The last range each seat was given by a load (preflop action, typical
  // range, narrowing, or another screen's prefill) and where it came from --
  // what desktop's "Reset" goes back to and its "Both players" cards describe.
  const [loadedRanges, setLoadedRanges] = useState<
    Partial<Record<Position, { range: HandRange; source: string }>>
  >(() =>
    seed
      ? Object.fromEntries(
          Object.entries(seed.ranges).map(([p, range]) => [p, { range, source: "From your Library" }]),
        )
      : prefill
        ? { [prefill.hero]: { range: prefill.heroRange, source: "From your Ranges chart" } }
        : {},
  );
  function markLoaded(entries: [Position, HandRange, string][]) {
    setLoadedRanges((prev) => {
      const next = { ...prev };
      for (const [position, range, source] of entries) next[position] = { range, source };
      return next;
    });
  }
  const oopRange = ranges[oopPosition] ?? {};
  const ipRange = ranges[ipPosition] ?? {};
  const oopChartState = chartStates[oopPosition] ?? { kind: "idle" as const };
  const ipChartState = chartStates[ipPosition] ?? { kind: "idle" as const };
  function setRangeFor(position: Position, range: HandRange) {
    setRanges((prev) => ({ ...prev, [position]: range }));
  }
  function setChartStateFor(position: Position, state: ChartLoadState) {
    setChartStates((prev) => ({ ...prev, [position]: state }));
  }
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  // The most recent successful solve, kept while a later solve runs or fails
  // (desktop keeps showing it; the phone page reads `outcome` only).
  const [lastSolved, setLastSolved] = useState<Extract<Outcome, { kind: "solved" }> | null>(null);
  // "Narrow ranges by earlier action": its own status, plus the ranges as they
  // were before the last narrowing so it can be undone.
  const [narrowState, setNarrowState] = useState<NarrowState>({ kind: "idle" });
  // "Load ranges from the preflop action": which line it loaded, or why not.
  const [preflopLoad, setPreflopLoad] = useState<PreflopLoadState>({ kind: "idle" });
  const [rangesBeforeNarrow, setRangesBeforeNarrow] = useState<Partial<
    Record<Position, HandRange>
  > | null>(null);

  // Click-through mode's own state: a true starting stack (before any
  // action) plus each street's real action log -- pot_bb/effective_stack_bb
  // for whichever street the board's card count lands on are computed from
  // these, never typed in directly (see docs/decisions.md's 2026-10-07
  // entry on why the old flat pot_bb=100/effective_stack_bb=33 defaults
  // didn't make sense).
  const [startingStackBb, setStartingStackBb] = useState(seed?.startingStackBb ?? prefill?.startingStackBb ?? 100);
  const [streets, setStreets] = useState<Record<Street, BuilderAction[]>>(seed?.streets ?? EMPTY_STREETS);
  // Actions stepped back over (via Back or a street's own Undo), newest
  // last -- what "Forward" re-applies. Any fresh action clears it.
  const [redoStack, setRedoStack] = useState<{ street: Street; action: BuilderAction }[]>([]);

  // Paste mode's own state -- unchanged from before this street-by-street
  // builder existed: a hand history directly tells you pot/stack/board at
  // the point it stops, so there's nothing to click through.
  const [handHistoryText, setHandHistoryText] = useState("");
  const [handHistoryError, setHandHistoryError] = useState<string | null>(null);
  const [pastedPotBb, setPastedPotBb] = useState(seed?.pastedPotBb ?? 0);
  const [pastedStackBb, setPastedStackBb] = useState(seed?.pastedStackBb ?? 0);
  const [oopAlreadyChecked, setOopAlreadyChecked] = useState(seed?.oopAlreadyChecked ?? false);
  const [pasteLoaded, setPasteLoaded] = useState(seed?.setupMode === "paste");

  function loadFromHandHistory() {
    const result = parseHandHistoryToPostflopSetup(handHistoryText);
    if (result.kind === "unrecognized") {
      setHandHistoryError(result.reason);
      return;
    }
    setHandHistoryError(null);
    const { setup } = result;
    setSeatA(setup.oopPosition);
    setSeatB(setup.ipPosition);
    setPastedStackBb(setup.effectiveStackBb);
    setPastedPotBb(setup.potBb);
    setBoardMode("pick");
    setPickedCards(setup.board);
    setOopAlreadyChecked(setup.oopAlreadyChecked);
    setPasteLoaded(true);
  }

  const board = boardMode === "pick" ? boardFromCards(pickedCards) : parseBoardText(boardText);
  const boardLength =
    board.kind === "ok" ? board.cards.length : boardMode === "pick" ? pickedCards.length : 0;
  const positionsAreValid = oopPosition !== ipPosition;

  const preflop = preflopContext(oopPosition, ipPosition, startingStackBb);
  const handSummary = summarizeHand(oopPosition, ipPosition, startingStackBb, streets, boardLength);

  const potBb = setupMode === "click" ? handSummary.potBb : pastedPotBb;
  const effectiveStackBb = setupMode === "click" ? handSummary.effectiveStackBb : pastedStackBb;
  const currentStreet = setupMode === "click" ? handSummary.targetStreet : streetForBoardLength(boardLength);
  const currentStreetActions: BuilderAction[] =
    setupMode === "click"
      ? streets[handSummary.targetStreet]
      : oopAlreadyChecked
        ? [{ position: oopPosition, action: "check" }]
        : [];

  const setupIsReady =
    setupMode === "click"
      ? handSummary.blockedReason === null && boardLength >= 3
      : pasteLoaded;

  const rangesAreValid = Object.keys(oopRange).length > 0 && Object.keys(ipRange).length > 0;
  const canSubmit =
    positionsAreValid && setupIsReady && rangesAreValid && board.kind === "ok";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await solve();
  }

  /**
   * Solve the current setup. `nextStreets` solves a just-changed action log
   * right away (desktop's "Keep exploring" adds an action and solves in one
   * click), instead of waiting a render for state to catch up.
   */
  async function solve(nextStreets?: Record<Street, BuilderAction[]>): Promise<boolean> {
    if (!canSubmit || board.kind !== "ok") return false;
    let street = currentStreet;
    let streetActions = currentStreetActions;
    let pot = potBb;
    let stack = effectiveStackBb;
    if (nextStreets && setupMode === "click") {
      const next = summarizeHand(oopPosition, ipPosition, startingStackBb, nextStreets, boardLength);
      if (next.blockedReason !== null) return false;
      street = next.targetStreet;
      streetActions = nextStreets[next.targetStreet];
      pot = next.potBb;
      stack = next.effectiveStackBb;
    }

    const spot: Spot = {
      positions_in_hand: [oopPosition, ipPosition],
      effective_stack_bb: stack,
      pot_bb: pot,
      board: board.cards,
      current_street: street,
      actions: toBettingActions(street, streetActions),
      ranges: { [oopPosition]: oopRange, [ipPosition]: ipRange },
    };

    setOutcome({ kind: "loading" });
    const started = performance.now();
    const result = await solveSpot(spot);
    switch (result.kind) {
      case "solved": {
        const solved = {
          kind: "solved" as const,
          data: result.data,
          range: result.data.position === oopPosition ? oopRange : ipRange,
          elapsedMs: performance.now() - started,
          spot,
        };
        setOutcome(solved);
        setLastSolved(solved);
        return true;
      }
      case "invalid":
        setOutcome({ kind: "invalid", issues: result.issues });
        return false;
      case "rejected":
        setOutcome({ kind: "rejected", reason: result.reason });
        return false;
      case "busy":
        setOutcome({ kind: "busy" });
        return false;
      case "network-error":
        setOutcome({ kind: "network-error" });
        return false;
      case "error":
        setOutcome({ kind: "error", status: result.status });
        return false;
    }
  }

  /**
   * Seeds a position's range from reference-chart data (the same curated
   * charts /spots/reference-strategy already serves for Stage 2) instead
   * of leaving it empty -- an approximate real starting point to tweak,
   * not an accurate postflop range (the reference chart has no idea
   * what's happened since preflop).
   *
   * Tries the position's own opening chart first; BB has none (it can
   * never be first to act in an unopened pot), so for BB -- and as a
   * second attempt for anyone else's open miss -- this falls back to the
   * defend-vs-raise chart, treating `otherPosition` as the preflop
   * raiser. That's a real assumption, not just a lookup: it's only
   * accurate if the in-position player was actually the preflop
   * aggressor, which is the common case for a heads-up postflop pot but
   * not the only one. Charts cover BB defending against every other
   * 6-max seat, so this combination covers every position pair the
   * pickers allow; a genuine coverage gap (an unusual stack depth) still
   * falls through to the plain "no chart" message.
   */
  async function loadReferenceRange(
    position: Position,
    otherPosition: Position,
    setRange: (range: HandRange) => void,
    setStatus: (state: ChartLoadState) => void,
  ) {
    const stackForChart = setupMode === "click" ? startingStackBb : effectiveStackBb;
    setStatus({ kind: "loading" });
    const openResult = await fetchReferenceStrategy(buildOpenSpot(position, stackForChart));
    if (openResult.kind === "match") {
      setRange(openResult.data.ranges[position] ?? {});
      markLoaded([[position, openResult.data.ranges[position] ?? {}, `Typical ${position} opening range`]]);
      setStatus({ kind: "loaded" });
      return;
    }
    if (openResult.kind === "network-error") {
      setStatus({ kind: "unavailable", reason: "Couldn't reach the API." });
      return;
    }
    if (openResult.kind !== "no-match") {
      setStatus({ kind: "unavailable", reason: "Couldn't load a reference range." });
      return;
    }

    const defendResult = await fetchReferenceStrategy(
      buildVsRaiseSpot(position, otherPosition, stackForChart),
    );
    if (defendResult.kind === "match") {
      setRange(defendResult.data.ranges[position] ?? {});
      markLoaded([
        [position, defendResult.data.ranges[position] ?? {}, `Typical ${position} call vs a ${otherPosition} open`],
      ]);
      setStatus({ kind: "loaded" });
      return;
    }
    if (defendResult.kind === "network-error") {
      setStatus({ kind: "unavailable", reason: "Couldn't reach the API." });
      return;
    }
    setStatus({
      kind: "unavailable",
      reason: `No reference chart covers ${position} opening, or defending vs ${otherPosition}, at this stack -- build it manually.`,
    });
  }

  // Both ranges straight from the preflop line that was clicked through --
  // open and call, 3-bet, or 4-bet pot -- instead of per-seat guesses. Offered
  // once preflop has closed with at least one raise.
  const preflopHasRaise = streets.preflop.some(
    (a) => a.action === "raise" || a.action === "bet" || a.action === "all_in",
  );
  const canLoadPreflopRanges =
    setupMode === "click" && handSummary.targetStreet !== "preflop" && preflopHasRaise;

  /** Returns whether both ranges were loaded. */
  async function loadRangesFromPreflopAction(): Promise<boolean> {
    setPreflopLoad({ kind: "loading" });
    const result = await fetchPreflopRanges({
      positions_in_hand: [oopPosition, ipPosition],
      effective_stack_bb: startingStackBb,
      current_street: "preflop",
      actions: toBettingActions("preflop", streets.preflop),
    });
    switch (result.kind) {
      case "ok":
        setRanges((prev) => ({
          ...prev,
          [oopPosition]: result.data.ranges[oopPosition] ?? {},
          [ipPosition]: result.data.ranges[ipPosition] ?? {},
        }));
        // Fresh starting ranges: an earlier narrowing no longer applies to them.
        setRangesBeforeNarrow(null);
        setNarrowState({ kind: "idle" });
        setPreflopLoad({ kind: "loaded", description: result.data.description });
        markLoaded([
          [oopPosition, result.data.ranges[oopPosition] ?? {}, `From the preflop action: ${result.data.description}`],
          [ipPosition, result.data.ranges[ipPosition] ?? {}, `From the preflop action: ${result.data.description}`],
        ]);
        return true;
      case "unsupported":
      case "invalid":
        setPreflopLoad({ kind: "unavailable", reason: result.reason });
        return false;
      case "network-error":
        setPreflopLoad({ kind: "unavailable", reason: "Couldn't reach the API." });
        return false;
      case "error":
        setPreflopLoad({
          kind: "unavailable",
          reason: `Couldn't load ranges (the request returned HTTP ${result.status}).`,
        });
        return false;
    }
  }

  // The earlier postflop streets whose action can narrow the ranges for the
  // street being solved -- only when the hand was clicked through (a pasted
  // history carries no earlier-street actions) and every earlier street closed.
  const narrowStreets =
    setupMode === "click" && board.kind === "ok" && handSummary.blockedReason === null
      ? streetsToNarrow(handSummary.targetStreet)
      : [];

  /**
   * Range chaining: for each earlier postflop street in turn, asks the server
   * to solve that street and narrow both ranges by the recorded action, then
   * carries the result into the next one. Each step is a full street solve,
   * so this can take as long as solves do.
   */
  async function narrowByEarlierStreets() {
    if (board.kind !== "ok" || narrowStreets.length === 0) return;
    const before = ranges;
    let oop = oopRange;
    let ip = ipRange;
    let droppedHands = 0;
    for (const street of narrowStreets) {
      setNarrowState({ kind: "loading", street });
      const spot = buildNarrowSpot({
        oopPosition,
        ipPosition,
        startingStackBb,
        streets,
        board: board.cards,
        street,
        oopRange: oop,
        ipRange: ip,
      });
      const result = await narrowRanges(spot);
      if (result.kind !== "narrowed") {
        setNarrowState({ kind: "failed", reason: narrowFailureReason(result, street) });
        return;
      }
      const warning = unlikelyLineWarning(street, result.data.line_probability);
      if (warning) {
        setNarrowState({ kind: "failed", reason: warning });
        return;
      }
      for (const t of Object.values(result.data.trimmed ?? {})) droppedHands += t.dropped_entries;
      oop = result.data.ranges[oopPosition] ?? {};
      ip = result.data.ranges[ipPosition] ?? {};
      if (Object.keys(oop).length === 0 || Object.keys(ip).length === 0) {
        setNarrowState({
          kind: "failed",
          reason: `Nothing is left of a range after the ${street} action, so the ranges were left as they were.`,
        });
        return;
      }
    }
    setRangesBeforeNarrow(before);
    setRanges((prev) => ({ ...prev, [oopPosition]: oop, [ipPosition]: ip }));
    markLoaded([
      [oopPosition, oop, `Narrowed by ${describeStreets(narrowStreets)}`],
      [ipPosition, ip, `Narrowed by ${describeStreets(narrowStreets)}`],
    ]);
    setNarrowState({
      kind: "done",
      streets: describeStreets(narrowStreets),
      trimmedNote:
        droppedHands > 0
          ? ` Hands the line almost never involved (under 2% of a range's top hand) were dropped: ${droppedHands} in all.`
          : "",
    });
  }

  function undoNarrowing() {
    if (rangesBeforeNarrow) setRanges(rangesBeforeNarrow);
    setRangesBeforeNarrow(null);
    setNarrowState({ kind: "idle" });
  }

  /** Back to a blank page: every input, both ranges, and any result. */
  function resetAll() {
    setSetupMode("click");
    setSeatA("BB");
    setSeatB("BTN");
    setBoardMode("pick");
    setBoardText("");
    setPickedCards([]);
    setRanges({});
    setChartStates({});
    setLoadedRanges({});
    setOutcome({ kind: "idle" });
    setLastSolved(null);
    setNarrowState({ kind: "idle" });
    setRangesBeforeNarrow(null);
    setPreflopLoad({ kind: "idle" });
    setStartingStackBb(100);
    setStreets(EMPTY_STREETS);
    setRedoStack([]);
    setHandHistoryText("");
    setHandHistoryError(null);
    setPastedPotBb(0);
    setPastedStackBb(0);
    setOopAlreadyChecked(false);
    setPasteLoaded(false);
  }

  function setStreetActions(street: Street, actions: BuilderAction[]) {
    const before = streets[street];
    if (actions.length > before.length) {
      setRedoStack([]); // a new action forks the hand -- the old "future" is gone
    } else if (actions.length < before.length) {
      const removed = before.slice(actions.length).reverse();
      setRedoStack((prev) => [...prev, ...removed.map((action) => ({ street, action }))]);
    }
    setStreets((prev) => ({ ...prev, [street]: actions }));
  }

  /** Steps the whole hand back one action, across street boundaries. */
  function goBack() {
    const street = [...STREET_ORDER].reverse().find((st) => streets[st].length > 0);
    if (street) setStreetActions(street, streets[street].slice(0, -1));
  }

  function goForward() {
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setStreets((prev) => ({ ...prev, [next.street]: [...prev[next.street], next.action] }));
  }

  const hasActions = STREET_ORDER.some((st) => streets[st].length > 0);

  // Desktop-only conveniences (the phone page doesn't read these).

  /** Preflop has closed (not folded): the point ranges can be auto-loaded. */
  const preflopState = computeStreetState(preflop, streets.preflop);
  const preflopClosed =
    setupMode === "click" ? preflopState.isTerminal && !preflopState.folded : pasteLoaded;

  /** Whose decision a solve of the current setup works out. */
  const decisionPosition: Position =
    setupMode === "click"
      ? handSummary.targetState.toAct
      : oopAlreadyChecked
        ? ipPosition
        : oopPosition;

  /** The preflop line can seed both ranges: clicked through, closed, and
   * raised (the phone's canLoadPreflopRanges also waits for a flop). */
  const canUsePreflopLine = setupMode === "click" && preflopClosed && preflopHasRaise;

  /** Fill both ranges with no clicks: from the preflop line when the server
   * can serve it, else each player's typical range (the per-seat fallback). */
  async function autoLoadRanges() {
    if (canUsePreflopLine && (await loadRangesFromPreflopAction())) return;
    await Promise.all([
      loadReferenceRange(oopPosition, ipPosition, (r) => setRangeFor(oopPosition, r), (st) => setChartStateFor(oopPosition, st)),
      loadReferenceRange(ipPosition, oopPosition, (r) => setRangeFor(ipPosition, r), (st) => setChartStateFor(ipPosition, st)),
    ]);
  }

  /** The setup as a Spot to save (desktop's "Save spot"): the whole hand's
   * actions, both ranges, the board. No solve result. In click-through mode
   * effective_stack_bb is the starting stack and the actions replay from it;
   * from a hand history it's the stack at the decision. See docs/decisions.md. */
  function setupAsSpot(): Spot {
    const actions =
      setupMode === "click"
        ? STREET_ORDER.flatMap((st) => toBettingActions(st, streets[st]))
        : toBettingActions(currentStreet, currentStreetActions);
    // A spot opened from the Library keeps its name; a new one is named by
    // what's in it (renamable in the Library).
    const cards = board.kind === "ok" ? board.cards : [];
    const name =
      savedSpot?.name ??
      (cards.length > 0 ? `${oopPosition} vs ${ipPosition} on ${cardsInWords(cards)}` : `${oopPosition} vs ${ipPosition}, preflop`);
    return {
      name,
      positions_in_hand: [oopPosition, ipPosition],
      effective_stack_bb: setupMode === "click" ? startingStackBb : effectiveStackBb,
      pot_bb: potBb,
      board: board.kind === "ok" ? board.cards : [],
      current_street: currentStreet,
      actions,
      ranges: { [oopPosition]: oopRange, [ipPosition]: ipRange },
    };
  }

  const missing: string[] = [];
  if (!positionsAreValid) missing.push("Pick two different positions.");
  if (setupMode === "paste" && !pasteLoaded) {
    missing.push("Load a hand history in step 1.");
  } else if (setupMode === "click" && handSummary.blockedReason !== null) {
    missing.push("Finish the action on the earlier streets in step 1.");
  }
  if (boardLength < 3) missing.push("Pick at least 3 board cards (the flop) in step 2.");
  else if (board.kind !== "ok") missing.push("Fix the board in step 2.");
  if (Object.keys(oopRange).length === 0) missing.push(`Add hands to ${oopPosition}'s range in step 3.`);
  if (Object.keys(ipRange).length === 0) missing.push(`Add hands to ${ipPosition}'s range in step 3.`);

  const spotSummary =
    board.kind === "ok"
      ? `${oopPosition} vs ${ipPosition} · ${currentStreet} ${board.cards.join(" ")} · pot ${potBb.toLocaleString()}bb`
      : `${oopPosition} vs ${ipPosition}`;

  return {
    solve,
    loadedRanges,
    preflopClosed,
    decisionPosition,
    autoLoadRanges,
    canUsePreflopLine,
    lastSolved,
    setupAsSpot,
    setupMode,
    setSetupMode,
    seatA,
    setSeatA,
    seatB,
    setSeatB,
    oopPosition,
    ipPosition,
    boardMode,
    setBoardMode,
    boardText,
    setBoardText,
    pickedCards,
    setPickedCards,
    ranges,
    setRanges,
    chartStates,
    setChartStates,
    oopRange,
    ipRange,
    oopChartState,
    ipChartState,
    outcome,
    setOutcome,
    narrowState,
    setNarrowState,
    preflopLoad,
    setPreflopLoad,
    rangesBeforeNarrow,
    setRangesBeforeNarrow,
    startingStackBb,
    setStartingStackBb,
    streets,
    setStreets,
    redoStack,
    setRedoStack,
    handHistoryText,
    setHandHistoryText,
    handHistoryError,
    setHandHistoryError,
    pastedPotBb,
    setPastedPotBb,
    pastedStackBb,
    setPastedStackBb,
    oopAlreadyChecked,
    setOopAlreadyChecked,
    pasteLoaded,
    setPasteLoaded,
    board,
    boardLength,
    positionsAreValid,
    preflop,
    handSummary,
    potBb,
    effectiveStackBb,
    currentStreet,
    currentStreetActions,
    setupIsReady,
    rangesAreValid,
    canSubmit,
    preflopHasRaise,
    canLoadPreflopRanges,
    narrowStreets,
    hasActions,
    missing,
    spotSummary,
    setRangeFor,
    setChartStateFor,
    loadFromHandHistory,
    handleSubmit,
    loadReferenceRange,
    loadRangesFromPreflopAction,
    narrowByEarlierStreets,
    undoNarrowing,
    resetAll,
    setStreetActions,
    goBack,
    goForward,
  };
}

export type SolveSetup = ReturnType<typeof useSolveSetup>;
