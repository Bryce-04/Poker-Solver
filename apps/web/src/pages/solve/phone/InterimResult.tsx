import { StrategyGrid } from "../../../components/StrategyGrid/StrategyGrid";
import { handMass, indexRange } from "../../../lib/rangeCombos";
import { formatMix, overallMix } from "../../../lib/strategySummary";
import type { SolveSetup } from "../useSolveSetup";
import "../../SolvePage.css";

/**
 * The phone's result screen until Phase 3 of docs/mobile-redesign.md (§4.5)
 * rebuilds it: the strategy chart and notes the old phone page showed under
 * its form, for the last solve.
 */
export function InterimResult({ s, onBack }: { s: SolveSetup; onBack: () => void }) {
  const solved = s.lastSolved;
  if (!solved) {
    return (
      <div className="m-section">
        <h1 className="m-step__title">No result yet</h1>
        <p className="m-step__lede">Solve a spot first.</p>
        <button type="button" className="m-btn m-btn--secondary" onClick={onBack}>
          Back to setup
        </button>
      </div>
    );
  }
  const { data, range, spot } = solved;

  return (
    <div className="spot-builder__result">
      <button type="button" className="m-btn m-btn--ghost m-btn--inline" onClick={onBack}>
        &larr; Back to setup
      </button>
      <h1 className="m-step__title">
        {data.position}&rsquo;s {spot.current_street} strategy
      </h1>
      <p className="spot-builder__source-label">
        Live solve ({data.iterations.toLocaleString()} iterations) &mdash; {data.position}&rsquo;s strategy:
      </p>
      {Object.keys(data.strategy).length > 0 && (
        <p className="solve-page__headline">
          {data.position} to act. Across the whole range, counting each hand by how much of the range it is:{" "}
          {formatMix(overallMix(data.strategy, handMass(indexRange(range))))}.
        </p>
      )}
      <p className="spot-builder__hint">
        How to read this: each square is a starting hand, colored by how often the solver takes each action with
        it. A square with several colors means the solver mixes between those actions on purpose, so opponents
        can&rsquo;t read it. Tap a square for the exact numbers.
      </p>
      {data.converged === false && (
        <p className="spot-builder__hint">
          The server hit its time limit before fully converging, so this is rougher than usual &mdash; treat close
          frequencies loosely.
        </p>
      )}
      {Object.keys(data.strategy).length === 0 ? (
        <p className="spot-builder__hint">
          No hand in that range got enough samples to report a strategy for &mdash; try more iterations or a
          narrower board/range combination.
        </p>
      ) : (
        <StrategyGrid
          strategy={data.strategy}
          comboStrategy={data.combo_strategy}
          deadCards={spot.board ?? []}
          range={range}
        />
      )}
      <details className="solve-page__details">
        <summary>Details</summary>
        {data.exploitability_pct !== undefined && (
          <p className="spot-builder__hint">
            Within {data.exploitability_pct.toFixed(2)}% of the pot of a true equilibrium &mdash; the most a perfect
            opponent could gain against this strategy.
          </p>
        )}
        {data.bucketed_actions.length > 0 && (
          <ul className="spot-builder__hint">
            {data.bucketed_actions.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
