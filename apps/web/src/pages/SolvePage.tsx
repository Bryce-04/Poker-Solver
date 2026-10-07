import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS } from "../lib/positions";
import { boardFromCards, parseBoardText } from "../lib/cards";
import { buildOpenSpot, buildVsRaiseSpot } from "../lib/spot";
import {
  fetchReferenceStrategy,
  solveSpot,
  type LiveSolveResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { CardPicker } from "../components/CardPicker/CardPicker";
import { StrategyGrid } from "../components/StrategyGrid/StrategyGrid";
import "../components/SpotBuilder/SpotBuilder.css";
import "./SolvePage.css";

type BoardMode = "pick" | "text";

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


/**
 * Stage 5's live-solve screen: a real MCCFR solve (apps/api's
 * POST /spots/solve) instead of a static reference chart. Needs a board
 * and BOTH players' ranges, not just hero's -- the convention
 * apps/api/app/solve.py defines: index 0 is out-of-position/first-to-act
 * this street, index 1 is in position.
 *
 * The board has two input modes -- click cards (CardPicker) or type them
 * (lib/cards.ts's parseBoardText) -- per docs/decisions.md's 2026-10-06
 * entries: the text field was a deliberate v1, and the picker is an
 * additional mode, not a replacement. Both converge on the same
 * ParseBoardResult, so canSubmit/the submitted Spot only have one code
 * path past that point.
 */
export function SolvePage() {
  const [oopPosition, setOopPosition] = useState<Position>("BB");
  const [ipPosition, setIpPosition] = useState<Position>("BTN");
  const [effectiveStackBb, setEffectiveStackBb] = useState(33);
  const [potBb, setPotBb] = useState(100);
  const [boardMode, setBoardMode] = useState<BoardMode>("pick");
  const [boardText, setBoardText] = useState("");
  const [pickedCards, setPickedCards] = useState<string[]>([]);
  const [oopAlreadyChecked, setOopAlreadyChecked] = useState(false);
  const [oopRange, setOopRange] = useState<HandRange>({});
  const [ipRange, setIpRange] = useState<HandRange>({});
  const [oopChartState, setOopChartState] = useState<ChartLoadState>({ kind: "idle" });
  const [ipChartState, setIpChartState] = useState<ChartLoadState>({ kind: "idle" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const board = boardMode === "pick" ? boardFromCards(pickedCards) : parseBoardText(boardText);
  const positionsAreValid = oopPosition !== ipPosition;
  const stackIsValid = Number.isFinite(effectiveStackBb) && effectiveStackBb > 0;
  const potIsValid = Number.isFinite(potBb) && potBb > 0;
  const rangesAreValid = Object.keys(oopRange).length > 0 && Object.keys(ipRange).length > 0;
  const canSubmit =
    positionsAreValid && stackIsValid && potIsValid && rangesAreValid && board.kind === "ok";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || board.kind !== "ok") return;

    const street = streetForBoardLength(board.cards.length);
    const spot: Spot = {
      positions_in_hand: [oopPosition, ipPosition],
      effective_stack_bb: effectiveStackBb,
      pot_bb: potBb,
      board: board.cards,
      current_street: street,
      actions: oopAlreadyChecked
        ? [{ position: oopPosition, street, action: "check" }]
        : [],
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
    setStatus({ kind: "loading" });
    const openResult = await fetchReferenceStrategy(buildOpenSpot(position, effectiveStackBb));
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
      buildVsRaiseSpot(position, otherPosition, effectiveStackBb),
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

  return (
    <div className="spot-builder">
      <form className="spot-builder__form" onSubmit={handleSubmit}>
        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Players</h2>

          <label className="spot-builder__field">
            Out of position (acts first)
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

          <label className="spot-builder__field spot-builder__field--radio">
            <input
              type="checkbox"
              checked={oopAlreadyChecked}
              onChange={(e) => setOopAlreadyChecked(e.target.checked)}
            />
            {oopPosition} already checked &mdash; solve {ipPosition}&rsquo;s decision
          </label>
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">Board &amp; stakes</h2>

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

          <label className="spot-builder__field">
            Pot (bb)
            <input
              type="number"
              min={0}
              step="any"
              value={potBb}
              onChange={(e) => setPotBb(Number(e.target.value))}
            />
          </label>
          {!potIsValid && (
            <p className="spot-builder__field-error">Enter a pot size greater than 0.</p>
          )}

          <label className="spot-builder__field">
            Effective stack (bb)
            <input
              type="number"
              min={0}
              step="any"
              value={effectiveStackBb}
              onChange={(e) => setEffectiveStackBb(Number(e.target.value))}
            />
          </label>
          {!stackIsValid && (
            <p className="spot-builder__field-error">Enter a stack size greater than 0.</p>
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
            runs a real MCCFR solve, not a lookup, so it takes a few seconds.
          </p>
        )}

        {outcome.kind === "loading" && (
          <p>
            <span className="spot-builder__spinner" aria-hidden="true" />
            Solving&hellip; this runs thousands of iterations server-side, so
            it can take several seconds.
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
