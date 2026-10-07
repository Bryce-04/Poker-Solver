import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS } from "../lib/positions";
import { boardFromCards, parseBoardText } from "../lib/cards";
import { buildOpenSpot, buildVsRaiseSpot } from "../lib/spot";
import { parseHandHistoryToPostflopSetup } from "../lib/parseHandHistory";
import { STREET_ORDER, summarizeHand, toBettingActions } from "../lib/handBuilder";
import type { BuilderAction } from "../lib/handBuilder";
import {
  fetchReferenceStrategy,
  solveSpot,
  type LiveSolveResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { CardPicker } from "../components/CardPicker/CardPicker";
import { StrategyGrid } from "../components/StrategyGrid/StrategyGrid";
import { StreetActions } from "../components/StreetActions/StreetActions";
import "../components/SpotBuilder/SpotBuilder.css";
import "./SolvePage.css";

type BoardMode = "pick" | "text";
type SetupMode = "click" | "paste";

type Outcome =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "solved"; data: LiveSolveResponse }
  | { kind: "invalid"; issues: SpotValidationIssue[] }
  | { kind: "rejected"; reason: string }
  | { kind: "network-error" }
  | { kind: "error"; status: number };

// Status for each position's "Load reference range" button -- separate
// from the solve Outcome above, since loading a starting range and
// submitting a solve are independent actions with independent feedback.
type ChartLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded" }
  | { kind: "unavailable"; reason: string };

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
  const [oopPosition, setOopPosition] = useState<Position>("BB");
  const [ipPosition, setIpPosition] = useState<Position>("BTN");
  const [boardMode, setBoardMode] = useState<BoardMode>("pick");
  const [boardText, setBoardText] = useState("");
  const [pickedCards, setPickedCards] = useState<string[]>([]);
  const [oopRange, setOopRange] = useState<HandRange>({});
  const [ipRange, setIpRange] = useState<HandRange>({});
  const [oopChartState, setOopChartState] = useState<ChartLoadState>({ kind: "idle" });
  const [ipChartState, setIpChartState] = useState<ChartLoadState>({ kind: "idle" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  // Click-through mode's own state: a true starting stack (before any
  // action) plus each street's real action log -- pot_bb/effective_stack_bb
  // for whichever street the board's card count lands on are computed from
  // these, never typed in directly (see docs/decisions.md's 2026-10-07
  // entry on why the old flat pot_bb=100/effective_stack_bb=33 defaults
  // didn't make sense).
  const [startingStackBb, setStartingStackBb] = useState(100);
  const [streets, setStreets] = useState<Record<Street, BuilderAction[]>>(EMPTY_STREETS);

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
    setOopPosition(setup.oopPosition);
    setIpPosition(setup.ipPosition);
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
        setOutcome({ kind: "solved", data: result.data });
        return;
      case "invalid":
        setOutcome({ kind: "invalid", issues: result.issues });
        return;
      case "rejected":
        setOutcome({ kind: "rejected", reason: result.reason });
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

  function setStreetActions(street: Street, actions: BuilderAction[]) {
    setStreets((prev) => ({ ...prev, [street]: actions }));
  }

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Jump to a decision</h2>
          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="setup-mode"
              checked={setupMode === "click"}
              onChange={() => setSetupMode("click")}
            />
            Click through the hand
          </label>
          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="setup-mode"
              checked={setupMode === "paste"}
              onChange={() => setSetupMode("paste")}
            />
            From a hand history
          </label>

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
              Set the positions and starting stack below, then click through
              the hand street by street -- pot and effective stack are
              computed from what you enter, not typed in.
            </p>
          )}
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Players</h2>

          <label className="spot-builder__field">
            Out of position (acts first postflop)
            <select
              value={oopPosition}
              onChange={(e) => setOopPosition(e.target.value as Position)}
            >
              {SIX_MAX_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="spot-builder__field">
            In position
            <select
              value={ipPosition}
              onChange={(e) => setIpPosition(e.target.value as Position)}
            >
              {SIX_MAX_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {!positionsAreValid && (
            <p className="spot-builder__field-error">The two positions must differ.</p>
          )}

          {setupMode === "click" && (
            <label className="spot-builder__field">
              Starting effective stack (bb)
              <input
                type="number"
                min={0}
                step="any"
                value={startingStackBb}
                onChange={(e) => setStartingStackBb(Number(e.target.value))}
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
        </section>

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
              <section className="spot-builder__section" key={street}>
                <h2 className="spot-builder__legend">
                  {street.charAt(0).toUpperCase() + street.slice(1)}
                </h2>
                {street === "preflop" && status === "current" && (
                  <p className="spot-builder__hint">
                    Blinds assumed at 1bb/0.5bb. {ipPosition} (small blind)
                    acts first.
                  </p>
                )}
                {status === "blocked" ? (
                  <p className="spot-builder__field-error">{handSummary.blockedReason}</p>
                ) : (
                <StreetActions
                  street={street}
                  ctx={
                    street === "preflop"
                      ? {
                          oopPosition,
                          ipPosition,
                          potBeforeBb: 0,
                          stackBeforeBb: startingStackBb,
                          firstToAct: ipPosition,
                          initialContributed: { [oopPosition]: 1, [ipPosition]: 0.5 },
                          isPreflop: true,
                        }
                      : {
                          oopPosition,
                          ipPosition,
                          potBeforeBb: status === "current" ? handSummary.potBb : 0,
                          stackBeforeBb:
                            status === "current" ? handSummary.effectiveStackBb : startingStackBb,
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

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Board</h2>

          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="board-mode"
              checked={boardMode === "pick"}
              onChange={() => setBoardMode("pick")}
            />
            Pick cards
          </label>
          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="radio"
              name="board-mode"
              checked={boardMode === "text"}
              onChange={() => setBoardMode("text")}
            />
            Type it
          </label>

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
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">{oopPosition}&rsquo;s range</h2>
          <div className="solve-page__chart-load">
            <button
              type="button"
              className="spot-builder__reset"
              onClick={() =>
                loadReferenceRange(oopPosition, ipPosition, setOopRange, setOopChartState)
              }
              disabled={oopChartState.kind === "loading"}
            >
              {oopChartState.kind === "loading"
                ? "Loading…"
                : `Load ${oopPosition}'s opening range`}
            </button>
            {oopChartState.kind === "unavailable" && (
              <span className="spot-builder__save-status spot-builder__save-status--warn">
                {oopChartState.reason}
              </span>
            )}
          </div>
          <RangeGrid value={oopRange} onChange={setOopRange} />
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">{ipPosition}&rsquo;s range</h2>
          <div className="solve-page__chart-load">
            <button
              type="button"
              className="spot-builder__reset"
              onClick={() =>
                loadReferenceRange(ipPosition, oopPosition, setIpRange, setIpChartState)
              }
              disabled={ipChartState.kind === "loading"}
            >
              {ipChartState.kind === "loading"
                ? "Loading…"
                : `Load ${ipPosition}'s opening range`}
            </button>
            {ipChartState.kind === "unavailable" && (
              <span className="spot-builder__save-status spot-builder__save-status--warn">
                {ipChartState.reason}
              </span>
            )}
          </div>
          <RangeGrid value={ipRange} onChange={setIpRange} />
        </section>

        <button type="submit" disabled={!canSubmit || outcome.kind === "loading"}>
          Solve
        </button>
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

        {outcome.kind === "network-error" && (
          <div className="spot-builder__status-block spot-builder__status-block--error">
            <p className="spot-builder__status-title">Couldn&rsquo;t reach the API.</p>
            <p>
              Is <code>apps/api</code> running? Start it with{" "}
              <code>cd apps/api &amp;&amp; uvicorn app.main:app --reload</code>.
            </p>
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
          {Object.keys(outcome.data.strategy).length === 0 ? (
            <p className="spot-builder__hint">
              No hand in that range got enough samples to report a strategy for
              &mdash; try more iterations or a narrower board/range combination.
            </p>
          ) : (
            <StrategyGrid strategy={outcome.data.strategy} />
          )}
        </div>
      )}
    </div>
  );
}
