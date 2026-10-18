import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS, assignPostflopSeats } from "../lib/positions";
import { boardFromCards, parseBoardText } from "../lib/cards";
import { buildOpenSpot, buildVsRaiseSpot } from "../lib/spot";
import { parseHandHistoryToPostflopSetup } from "../lib/parseHandHistory";
import { STREET_ORDER, preflopContext, summarizeHand, toBettingActions } from "../lib/handBuilder";
import type { BuilderAction } from "../lib/handBuilder";
import {
  fetchPreflopRanges,
  fetchReferenceStrategy,
  narrowRanges,
  solveSpot,
  type LiveSolveResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { CardPicker } from "../components/CardPicker/CardPicker";
import { StrategyGrid } from "../components/StrategyGrid/StrategyGrid";
import { StreetActions } from "../components/StreetActions/StreetActions";
import { Step } from "../components/Step/Step";
import {
  buildNarrowSpot,
  describeStreets,
  streetsToNarrow,
  unlikelyLineWarning,
} from "../lib/chaining";
import { formatMix, overallMix } from "../lib/strategySummary";
import { handMass, indexRange } from "../lib/rangeCombos";
import "../components/SpotBuilder/SpotBuilder.css";
import "./SolvePage.css";

type BoardMode = "pick" | "text";
type SetupMode = "click" | "paste";

type Outcome =
  | { kind: "idle" }
  | { kind: "loading" }
  // `range` is the deciding player's range as it was when solved, so the
  // result can fade hands that are barely in it (later edits don't move it).
  | { kind: "solved"; data: LiveSolveResponse; range: HandRange }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "rejected"; reason: string }
  | { kind: "busy" }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

type PreflopLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; description: string }
  | { kind: "unavailable"; reason: string };

type NarrowState =
  | { kind: "idle" }
  | { kind: "loading"; street: string }
  | { kind: "done"; streets: string; trimmedNote: string }
  | { kind: "failed"; reason: string };

// Status for each position's "Load reference range" button -- separate
// from the solve Outcome above, since loading a starting range and
// submitting a solve are independent actions with independent feedback.
type ChartLoadState =
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
 * Stage 5's live-solve screen: a real MCCFR solve (apps/api's
 * POST /spots/solve) instead of a static reference chart. Needs a board
 * and BOTH players' ranges, not just hero's -- the convention
 * apps/api/app/solve.py defines: index 0 is out-of-position/first-to-act
 * this street, index 1 is in position.
 *
 * Two alternative ways to reach a decision point, picked via setupMode:
 * clicking through the hand street by street (lib/handBuilder.ts derives
 * pot_bb/effective_stack_bb from real actions plus 1/2 blinds, instead of
 * them being typed in), or pasting a hand history
 * (lib/parseHandHistory.ts's parseHandHistoryToPostflopSetup) when one's
 * already in hand. Both converge on the same board/ranges/solve machinery
 * below them -- see docs/decisions.md's 2026-10-07 entry for why these
 * are kept as two separate modes rather than merged into one state model.
 *
 * The board has two input modes -- click cards (CardPicker) or type them
 * (lib/cards.ts's parseBoardText) -- per docs/decisions.md's 2026-10-06
 * entries, shared by both setup modes: 3/4/5 cards picked is what unlocks
 * the flop/turn/river action-builder sections in click mode.
 */
export function SolvePage() {
  const [setupMode, setSetupMode] = useState<SetupMode>("click");
  // The two heads-up seats, in whichever order they were picked -- who is
  // out of position / in position is derived from them, never chosen.
  const [seatA, setSeatA] = useState<Position>("BB");
  const [seatB, setSeatB] = useState<Position>("BTN");
  const { oop: oopPosition, ip: ipPosition } = assignPostflopSeats(seatA, seatB);
  const [boardMode, setBoardMode] = useState<BoardMode>("pick");
  const [boardText, setBoardText] = useState("");
  const [pickedCards, setPickedCards] = useState<string[]>([]);
  // Ranges and "Load typical range" status are kept per SEAT, not per role,
  // so changing the other player never leaves a range on the wrong player.
  const [ranges, setRanges] = useState<Partial<Record<Position, HandRange>>>({});
  const [chartStates, setChartStates] = useState<Partial<Record<Position, ChartLoadState>>>({});
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
  const [startingStackBb, setStartingStackBb] = useState(100);
  const [streets, setStreets] = useState<Record<Street, BuilderAction[]>>(EMPTY_STREETS);
  // Actions stepped back over (via Back or a street's own Undo), newest
  // last -- what "Forward" re-applies. Any fresh action clears it.
  const [redoStack, setRedoStack] = useState<{ street: Street; action: BuilderAction }[]>([]);

  // Paste mode's own state -- unchanged from before this street-by-street
  // builder existed: a hand history directly tells you pot/stack/board at
  // the point it stops, so there's nothing to click through.
  const [handHistoryText, setHandHistoryText] = useState("");
  const [handHistoryError, setHandHistoryError] = useState<string | null>(null);
  const [pastedPotBb, setPastedPotBb] = useState(0);
  const [pastedStackBb, setPastedStackBb] = useState(0);
  const [oopAlreadyChecked, setOopAlreadyChecked] = useState(false);
  const [pasteLoaded, setPasteLoaded] = useState(false);

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
    if (!canSubmit || board.kind !== "ok") return;

    const spot: Spot = {
      positions_in_hand: [oopPosition, ipPosition],
      effective_stack_bb: effectiveStackBb,
      pot_bb: potBb,
      board: board.cards,
      current_street: currentStreet,
      actions: toBettingActions(currentStreet, currentStreetActions),
      ranges: { [oopPosition]: oopRange, [ipPosition]: ipRange },
    };

    setOutcome({ kind: "loading" });
    const result = await solveSpot(spot);
    switch (result.kind) {
      case "solved":
        setOutcome({
          kind: "solved",
          data: result.data,
          range: result.data.position === oopPosition ? oopRange : ipRange,
        });
        return;
      case "invalid":
        setOutcome({ kind: "invalid", issues: result.issues });
        return;
      case "rejected":
        setOutcome({ kind: "rejected", reason: result.reason });
        return;
      case "busy":
        setOutcome({ kind: "busy" });
        return;
      case "network-error":
        setOutcome({ kind: "network-error" });
        return;
      case "error":
        setOutcome({ kind: "error", status: result.status });
        return;
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

  async function loadRangesFromPreflopAction() {
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
        return;
      case "unsupported":
      case "invalid":
        setPreflopLoad({ kind: "unavailable", reason: result.reason });
        return;
      case "network-error":
        setPreflopLoad({ kind: "unavailable", reason: "Couldn't reach the API." });
        return;
      case "error":
        setPreflopLoad({
          kind: "unavailable",
          reason: `Couldn't load ranges (the request returned HTTP ${result.status}).`,
        });
        return;
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
    setOutcome({ kind: "idle" });
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

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <Step
          number={1}
          title="The hand"
          subtitle="Who is playing, and how the hand got to this point."
        >
          <div className="solve-page__segmented" role="radiogroup" aria-label="How to set up the hand">
            <label className="solve-page__segment" data-active={setupMode === "click"}>
              <input
                type="radio"
                name="setup-mode"
                checked={setupMode === "click"}
                onChange={() => setSetupMode("click")}
              />
              Click through the hand
            </label>
            <label className="solve-page__segment" data-active={setupMode === "paste"}>
              <input
                type="radio"
                name="setup-mode"
                checked={setupMode === "paste"}
                onChange={() => setSetupMode("paste")}
              />
              From a hand history
            </label>
          </div>

          {setupMode === "paste" && (
            <>
              <label className="spot-builder__field">
                Paste a hand history
                <textarea
                  className="spot-builder__hh-input"
                  rows={4}
                  value={handHistoryText}
                  onChange={(e) => setHandHistoryText(e.target.value)}
                  placeholder="Paste up through the point just before the decision you want to look at"
                />
              </label>
              <button type="button" className="spot-builder__reset" onClick={loadFromHandHistory}>
                Load from hand history
              </button>
              {handHistoryError && <p className="spot-builder__field-error">{handHistoryError}</p>}
              <p className="spot-builder__hint">
                Fills in positions, board, pot, and stack from what actually
                happened in the hand -- not ranges, since a hand history doesn&rsquo;t
                reveal villain&rsquo;s actual cards.
              </p>
            </>
          )}
          {setupMode === "click" && (
            <p className="spot-builder__hint">
              Choose the two players and the starting stack, then enter what
              happened on each street. Pot and remaining stack are worked out
              for you.
            </p>
          )}

          <label className="spot-builder__field">
            Player 1
            <select
              value={seatA}
              onChange={(e) => {
                setSeatA(e.target.value as Position);
                setRedoStack([]);
              }}
            >
              {SIX_MAX_POSITIONS.map((p) => (
                <option key={p} value={p} disabled={p === seatB}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="spot-builder__field">
            Player 2
            <select
              value={seatB}
              onChange={(e) => {
                setSeatB(e.target.value as Position);
                setRedoStack([]);
              }}
            >
              {SIX_MAX_POSITIONS.map((p) => (
                <option key={p} value={p} disabled={p === seatA}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {!positionsAreValid ? (
            <p className="spot-builder__field-error">The two positions must differ.</p>
          ) : (
            <p className="spot-builder__hint">
              {oopPosition} is out of position (acts first after the flop).{" "}
              {ipPosition} is in position (acts last).
            </p>
          )}

          {setupMode === "click" && (
            <label className="spot-builder__field">
              Starting stack (bb)
              <input
                type="number"
                min={0}
                step="any"
                value={startingStackBb}
                onChange={(e) => {
                  setStartingStackBb(Number(e.target.value));
                  setRedoStack([]);
                }}
              />
            </label>
          )}

          {setupMode === "paste" && (
            <label className="spot-builder__field spot-builder__field--radio">
              <input
                type="checkbox"
                checked={oopAlreadyChecked}
                onChange={(e) => setOopAlreadyChecked(e.target.checked)}
              />
              {oopPosition} already checked &mdash; solve {ipPosition}&rsquo;s decision
            </label>
          )}

          {setupMode === "click" && (
            <div className="solve-page__history">
              <button
                type="button"
                className="spot-builder__reset"
                onClick={goBack}
                disabled={!hasActions}
                aria-label="Back one action"
              >
                &larr; Back
              </button>
              <button
                type="button"
                className="spot-builder__reset"
                onClick={goForward}
                disabled={redoStack.length === 0}
                aria-label="Forward one action"
              >
                Forward &rarr;
              </button>
            </div>
          )}

          {setupMode === "click" &&
            STREET_ORDER.map((street, idx) => {
              const minCards = idx === 0 ? 0 : idx + 2; // preflop=always, flop=3, turn=4, river=5
              if (boardLength < minCards) return null;
              const targetIdx = STREET_ORDER.indexOf(handSummary.targetStreet);
              // Reached: this street already closed and we've moved past it
              // -- show its log as history, not live controls. Current:
              // this is exactly where the walk stopped. Blocked: the very
              // next street after where the walk stopped (shown once, with
              // why); anything further out just isn't rendered yet.
              if (idx > targetIdx + 1) return null;
              const status = idx < targetIdx ? "reached" : idx === targetIdx ? "current" : "blocked";

              return (
                <section className="spot-builder__section solve-page__street" key={street}>
                  <h3 className="spot-builder__legend">
                    {street.charAt(0).toUpperCase() + street.slice(1)}
                  </h3>
                  {street === "preflop" && status === "current" && (
                    <p className="spot-builder__hint">
                      Blinds 0.5/1bb. {preflop.firstToAct} acts first.
                      {preflop.potBeforeBb > 0 &&
                        ` ${preflop.potBeforeBb}bb of blinds from seats not in this hand is already in the pot.`}
                    </p>
                  )}
                  {status === "blocked" ? (
                    <p className="spot-builder__field-error">{handSummary.blockedReason}</p>
                  ) : (
                    <StreetActions
                      street={street}
                      ctx={
                        street === "preflop"
                          ? preflop
                          : {
                              oopPosition,
                              ipPosition,
                              potBeforeBb: status === "current" ? handSummary.potBb : 0,
                              stackBeforeBb:
                                status === "current"
                                  ? handSummary.effectiveStackBb
                                  : startingStackBb,
                              firstToAct: oopPosition,
                            }
                      }
                      actions={streets[street]}
                      onChange={(next) => setStreetActions(street, next)}
                      disabled={status === "reached"}
                    />
                  )}
                </section>
              );
            })}
        </Step>

        <Step
          number={2}
          title="The board"
          subtitle="The community cards: 3 for the flop, 4 for the turn, 5 for the river."
        >
          <div className="solve-page__segmented" role="radiogroup" aria-label="How to enter the board">
            <label className="solve-page__segment" data-active={boardMode === "pick"}>
              <input
                type="radio"
                name="board-mode"
                checked={boardMode === "pick"}
                onChange={() => setBoardMode("pick")}
              />
              Pick cards
            </label>
            <label className="solve-page__segment" data-active={boardMode === "text"}>
              <input
                type="radio"
                name="board-mode"
                checked={boardMode === "text"}
                onChange={() => setBoardMode("text")}
              />
              Type it
            </label>
          </div>

          {boardMode === "pick" ? (
            <CardPicker value={pickedCards} onChange={setPickedCards} />
          ) : (
            <label className="spot-builder__field">
              Board
              <input
                type="text"
                value={boardText}
                onChange={(e) => setBoardText(e.target.value)}
                placeholder="Ks Qh 9d"
              />
            </label>
          )}
          {boardMode === "text" && boardText.trim() !== "" && board.kind === "error" && (
            <p className="spot-builder__field-error">{board.reason}</p>
          )}
          {boardMode === "pick" && pickedCards.length > 0 && board.kind === "error" && (
            <p className="spot-builder__field-error">{board.reason}</p>
          )}
          {board.kind === "ok" ? (
            <p className="spot-builder__hint">
              {board.cards.length === 3 ? "Flop" : board.cards.length === 4 ? "Turn" : "River"}
              : {board.cards.join(" ")}
            </p>
          ) : (
            <p className="spot-builder__hint">
              3 cards (flop), 4 (turn), or 5 (river).
            </p>
          )}

          {setupMode === "click" && board.kind === "ok" && (
            <p className="spot-builder__hint">
              Pot entering the {currentStreet}: {potBb.toLocaleString()}bb &middot; effective
              stack: {effectiveStackBb.toLocaleString()}bb
            </p>
          )}
          {setupMode === "paste" && (
            <>
              <label className="spot-builder__field">
                Pot (bb)
                <input type="number" min={0} step="any" value={pastedPotBb} onChange={(e) => setPastedPotBb(Number(e.target.value))} />
              </label>
              <label className="spot-builder__field">
                Effective stack (bb)
                <input type="number" min={0} step="any" value={pastedStackBb} onChange={(e) => setPastedStackBb(Number(e.target.value))} />
              </label>
            </>
          )}
        </Step>

        <Step
          number={3}
          title="The ranges"
          subtitle="The hands each player could realistically have. Tap or drag on the grid to add or remove hands."
        >
          {canLoadPreflopRanges && (
            <section className="spot-builder__section">
              <h3 className="spot-builder__legend">From the preflop action</h3>
              <p className="spot-builder__hint">
                Fill in both players' ranges from how preflop went: an open and a call, a 3-bet pot
                (the 3-bettor's 3-bet range, the opener's call) or a 4-bet pot. Approximate ranges
                at about 100bb.
              </p>
              <div className="solve-page__chart-load">
                <button
                  type="button"
                  className="spot-builder__reset"
                  onClick={loadRangesFromPreflopAction}
                  disabled={preflopLoad.kind === "loading"}
                >
                  {preflopLoad.kind === "loading"
                    ? "Loading…"
                    : "Load both ranges from the preflop action"}
                </button>
              </div>
              {preflopLoad.kind === "loaded" && (
                <p className="spot-builder__hint" role="status">
                  Loaded for: {preflopLoad.description}.
                </p>
              )}
              {preflopLoad.kind === "unavailable" && (
                <p className="spot-builder__field-error" role="alert">
                  {preflopLoad.reason}
                </p>
              )}
            </section>
          )}
          {narrowStreets.length > 0 && (
            <section className="spot-builder__section solve-page__narrow">
              <h3 className="spot-builder__legend">Narrow by earlier action</h3>
              <p className="spot-builder__hint">
                Right now these ranges are where each player starts. Narrow them by what each
                player did on {describeStreets(narrowStreets)}: the solver works out which hands
                would actually have played that way, and keeps only those. Needs both ranges
                filled in, and takes about as long as a solve per street.
              </p>
              <div className="solve-page__chart-load">
                <button
                  type="button"
                  className="spot-builder__reset"
                  onClick={narrowByEarlierStreets}
                  disabled={
                    narrowState.kind === "loading" ||
                    Object.keys(oopRange).length === 0 ||
                    Object.keys(ipRange).length === 0
                  }
                >
                  {narrowState.kind === "loading"
                    ? `Narrowing by the ${narrowState.street}…`
                    : `Narrow ranges by ${describeStreets(narrowStreets)} action`}
                </button>
                {rangesBeforeNarrow && narrowState.kind === "done" && (
                  <button type="button" className="spot-builder__reset" onClick={undoNarrowing}>
                    Undo
                  </button>
                )}
              </div>
              {narrowState.kind === "done" && (
                <p className="spot-builder__hint" role="status">
                  Narrowed by {narrowState.streets}.{narrowState.trimmedNote} Hands with only some
                  suits left show a dot in the grid &mdash; use Suits to see which.
                </p>
              )}
              {narrowState.kind === "failed" && (
                <p className="spot-builder__field-error" role="alert">
                  {narrowState.reason}
                </p>
              )}
            </section>
          )}

          <section className="spot-builder__section">
            <h3 className="spot-builder__legend">{oopPosition}&rsquo;s range</h3>
            <div className="solve-page__chart-load">
              <button
                type="button"
                className="spot-builder__reset"
                onClick={() =>
                  loadReferenceRange(
                    oopPosition,
                    ipPosition,
                    (r) => setRangeFor(oopPosition, r),
                    (st) => setChartStateFor(oopPosition, st),
                  )
                }
                disabled={oopChartState.kind === "loading"}
              >
                {oopChartState.kind === "loading"
                  ? "Loading…"
                  : `Load ${oopPosition}'s typical range`}
              </button>
              <span className="spot-builder__hint">
                {Object.keys(oopRange).length} of 169 hand types selected
              </span>
              {oopChartState.kind === "unavailable" && (
                <span className="spot-builder__save-status spot-builder__save-status--warn">
                  {oopChartState.reason}
                </span>
              )}
            </div>
            <RangeGrid
              value={oopRange}
              onChange={(r) => setRangeFor(oopPosition, r)}
              deadCards={board.kind === "ok" ? board.cards : []}
            />
          </section>

          <section className="spot-builder__section">
            <h3 className="spot-builder__legend">{ipPosition}&rsquo;s range</h3>
            <div className="solve-page__chart-load">
              <button
                type="button"
                className="spot-builder__reset"
                onClick={() =>
                  loadReferenceRange(
                    ipPosition,
                    oopPosition,
                    (r) => setRangeFor(ipPosition, r),
                    (st) => setChartStateFor(ipPosition, st),
                  )
                }
                disabled={ipChartState.kind === "loading"}
              >
                {ipChartState.kind === "loading"
                  ? "Loading…"
                  : `Load ${ipPosition}'s typical range`}
              </button>
              <span className="spot-builder__hint">
                {Object.keys(ipRange).length} of 169 hand types selected
              </span>
              {ipChartState.kind === "unavailable" && (
                <span className="spot-builder__save-status spot-builder__save-status--warn">
                  {ipChartState.reason}
                </span>
              )}
            </div>
            <RangeGrid
              value={ipRange}
              onChange={(r) => setRangeFor(ipPosition, r)}
              deadCards={board.kind === "ok" ? board.cards : []}
            />
          </section>
        </Step>

        <Step
          number={4}
          title="Solve"
          subtitle="The solver works out the best mix of actions for the player to act."
        >
          <p className="solve-page__summary">{spotSummary}</p>
          {missing.length > 0 && (
            <ul className="solve-page__missing">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <div className="solve-page__actions">
            <button type="submit" disabled={!canSubmit || outcome.kind === "loading"}>
              Solve
            </button>
            <button type="button" className="spot-builder__reset" onClick={resetAll}>
              Reset
            </button>
          </div>
        </Step>
      </form>

      <div className="spot-builder__status" role="status" aria-live="polite">
        {outcome.kind === "idle" && (
          <p>
            Set up both players&rsquo; ranges and a board, then solve &mdash; this
            runs a real equilibrium solve, not a lookup, so it takes a few seconds.
          </p>
        )}

        {outcome.kind === "loading" && (
          <p>
            <span className="spot-builder__spinner" aria-hidden="true" />
            Solving&hellip; this trains until the result is within 0.5% of the
            pot of a true equilibrium, so a wide-range flop can take a while.
          </p>
        )}

        {outcome.kind === "invalid" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Invalid spot.</p>
            <p>The server rejected the spot:</p>
            <ul className="spot-builder__issues">
              {outcome.issues.map((issue, idx) => (
                <li key={idx}>
                  <code className="spot-builder__issue-loc">{issue.loc.join(" > ")}</code>
                  {" — "}
                  {issue.msg}
                </li>
              ))}
              {outcome.issues.length === 0 && (
                <li>The server did not return field-level details.</li>
              )}
            </ul>
          </div>
        )}

        {outcome.kind === "rejected" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Can&rsquo;t solve this spot yet.</p>
            <p>{outcome.reason}</p>
          </div>
        )}

        {outcome.kind === "busy" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">The solver is busy.</p>
            <p>
              Another solve is already running on the server &mdash; try again in
              a minute.
            </p>
          </div>
        )}

        {outcome.kind === "network-error" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Couldn&rsquo;t reach the API.</p>
            <p>
              Check your connection and try again. The server may also be
              waking up &mdash; give it a minute.
            </p>
            {import.meta.env.DEV && (
              <p>
                Dev: is <code>apps/api</code> running? Start it with{" "}
                <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
              </p>
            )}
          </div>
        )}

        {outcome.kind === "error" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Unexpected API response.</p>
            <p>The request failed with HTTP {outcome.status}.</p>
          </div>
        )}
      </div>

      {outcome.kind === "solved" && (
        <div className="spot-builder__result">
          <p className="spot-builder__source-label">
            Live solve ({outcome.data.iterations.toLocaleString()} iterations)
            &mdash; {outcome.data.position}&rsquo;s strategy:
          </p>
          {Object.keys(outcome.data.strategy).length > 0 && (
            <p className="solve-page__headline">
              {outcome.data.position} to act. Across the whole range, counting each hand
              by how much of the range it is:{" "}
              {formatMix(overallMix(outcome.data.strategy, handMass(indexRange(outcome.range))))}.
            </p>
          )}
          <p className="spot-builder__hint">
            How to read this: each square is a starting hand, colored by how often
            the solver takes each action with it. A square with several colors
            means the solver mixes between those actions on purpose, so
            opponents can&rsquo;t read it. Tap a square for the exact numbers.
          </p>
          {outcome.data.converged === false && (
            <p className="spot-builder__hint">
              The server hit its time limit before fully converging, so this is
              rougher than usual &mdash; treat close frequencies loosely.
            </p>
          )}
          {Object.keys(outcome.data.strategy).length === 0 ? (
            <p className="spot-builder__hint">
              No hand in that range got enough samples to report a strategy for
              &mdash; try more iterations or a narrower board/range combination.
            </p>
          ) : (
            <StrategyGrid
              strategy={outcome.data.strategy}
              comboStrategy={outcome.data.combo_strategy}
              deadCards={board.kind === "ok" ? board.cards : []}
              range={outcome.range}
            />
          )}
          <details className="solve-page__details">
            <summary>Details</summary>
            {outcome.data.exploitability_pct !== undefined && (
              <p className="spot-builder__hint">
                Within {outcome.data.exploitability_pct.toFixed(2)}% of the pot of a
                true equilibrium &mdash; the most a perfect opponent could gain
                against this strategy.
              </p>
            )}
            {outcome.data.bucketed_actions.length > 0 && (
              <ul className="spot-builder__hint">
                {outcome.data.bucketed_actions.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
    </div>
  );
}
