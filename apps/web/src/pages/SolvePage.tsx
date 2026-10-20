import type { Position } from "@poker-solver/schema";
import { SIX_MAX_POSITIONS } from "../lib/positions";
import { STREET_ORDER } from "../lib/handBuilder";
import { RangeGrid } from "../components/RangeGrid/RangeGrid";
import { CardPicker } from "../components/CardPicker/CardPicker";
import { StrategyGrid } from "../components/StrategyGrid/StrategyGrid";
import { StreetActions } from "../components/StreetActions/StreetActions";
import { Step } from "../components/Step/Step";
import { describeStreets } from "../lib/chaining";
import { formatMix, overallMix } from "../lib/strategySummary";
import { handMass, indexRange } from "../lib/rangeCombos";
import type { SolvePrefill } from "../lib/solvePrefill";
import "../components/SpotBuilder/SpotBuilder.css";
import "./SolvePage.css";
import { useIsDesktop } from "../lib/useIsDesktop";
import { useSolveSetup, type SolveSetup } from "./solve/useSolveSetup";
import { SolveWorkspace } from "./solve/SolveWorkspace";

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
export function SolvePage({ prefill }: { prefill?: SolvePrefill } = {}) {
  const setup = useSolveSetup(prefill);
  const isDesktop = useIsDesktop();
  return isDesktop ? <SolveWorkspace setup={setup} /> : <SolvePhone setup={setup} />;
}

/** The phone layout (< 1024px): the original four stacked steps. */
function SolvePhone({ setup }: { setup: SolveSetup }) {
  const {
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
    oopRange,
    ipRange,
    oopChartState,
    ipChartState,
    outcome,
    narrowState,
    preflopLoad,
    rangesBeforeNarrow,
    startingStackBb,
    setStartingStackBb,
    streets,
    redoStack,
    setRedoStack,
    handHistoryText,
    setHandHistoryText,
    handHistoryError,
    pastedPotBb,
    setPastedPotBb,
    pastedStackBb,
    setPastedStackBb,
    oopAlreadyChecked,
    setOopAlreadyChecked,
    board,
    boardLength,
    positionsAreValid,
    preflop,
    handSummary,
    potBb,
    effectiveStackBb,
    currentStreet,
    canSubmit,
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
  } = setup;

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
              <button type="button" className="spot-builder__reset btn-secondary" onClick={loadFromHandHistory}>
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
                className="spot-builder__reset btn-secondary"
                onClick={goBack}
                disabled={!hasActions}
                aria-label="Back one action"
              >
                &larr; Back
              </button>
              <button
                type="button"
                className="spot-builder__reset btn-secondary"
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
                  className="spot-builder__reset btn-secondary"
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
                  className="spot-builder__reset btn-secondary"
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
                  <button type="button" className="spot-builder__reset btn-secondary" onClick={undoNarrowing}>
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
                className="spot-builder__reset btn-secondary"
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
                className="spot-builder__reset btn-secondary"
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
            <button type="submit" className="btn-primary" disabled={!canSubmit || outcome.kind === "loading"}>
              Solve
            </button>
            <button type="button" className="spot-builder__reset btn-ghost" onClick={resetAll}>
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
