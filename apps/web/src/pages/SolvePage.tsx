import { useState } from "react";
import type { FormEvent } from "react";
import type { HandRange, Position, Spot, Street } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS } from "../lib/positions";
import { boardFromCards, parseBoardText } from "../lib/cards";
import {
  solveSpot,
  type LiveSolveResponse,
  type SpotValidationIssue,
} from "../lib/api";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { CardPicker } from "../components/CardPicker/CardPicker";
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

function streetForBoardLength(length: number): Street {
  if (length === 3) return "flop";
  if (length === 4) return "turn";
  return "river";
}

/** Every hand at one decision point shares the same legal actions, so the
 * first hand's keys are the table's columns. Empty if nothing in either
 * submitted range ever got sampled (board blocks every combo, etc). */
function actionColumns(strategy: Record<string, Record<string, number>>): string[] {
  const firstHand = Object.keys(strategy)[0];
  return firstHand ? Object.keys(strategy[firstHand]) : [];
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
          <RangeGrid value={oopRange} onChange={setOopRange} />
        </section>

        <section className="spot-builder__section">
          <h2 className="spot-builder__legend">{ipPosition}&rsquo;s range</h2>
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
            <div className="solve-page__table-wrap">
              <table className="solve-page__table">
                <thead>
                  <tr>
                    <th>Hand</th>
                    {actionColumns(outcome.data.strategy).map((action) => (
                      <th key={action}>{action}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(outcome.data.strategy)
                    .sort()
                    .map((hand) => (
                      <tr key={hand}>
                        <td>{hand}</td>
                        {actionColumns(outcome.data.strategy).map((action) => (
                          <td key={action}>
                            {Math.round((outcome.data.strategy[hand][action] ?? 0) * 100)}%
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
