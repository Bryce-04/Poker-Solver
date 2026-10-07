import { useState } from "react";
import type { CSSProperties } from "react";
import { HAND_GRID } from "../../lib/hands";
import "../RangeGrid/RangeGrid.css";
import "./StrategyGrid.css";

// Fixed left-to-right order so every cell's segments line up the same way,
// and a stable warm-to-dark ramp by aggression -- fold is its own cool
// color (leaving the hand is categorically different from escalating it),
// not just "the lightest red". Covers every action betting_round.py's
// fixed menu can ever produce, so no fallback-color case is needed.
const ACTION_ORDER = [
  "fold",
  "check",
  "call",
  "bet_small",
  "bet_medium",
  "bet_large",
  "all_in",
] as const;

const ACTION_COLOR_VAR: Record<string, string> = {
  fold: "--strategy-fold",
  check: "--strategy-passive",
  call: "--strategy-passive",
  bet_small: "--strategy-bet-small",
  bet_medium: "--strategy-bet-mid",
  bet_large: "--strategy-bet-big",
  all_in: "--strategy-allin",
};

const ACTION_LABEL: Record<string, string> = {
  fold: "Fold",
  check: "Check",
  call: "Call",
  bet_small: "Bet Small (25%)",
  bet_medium: "Bet Medium (75%)",
  bet_large: "Bet Large (125%)",
  all_in: "All-in",
};

function orderedEntries(hand: Record<string, number>): [string, number][] {
  return ACTION_ORDER.filter((a) => a in hand).map((a) => [a, hand[a]]);
}

/** A multi-stop left-to-right gradient, one stop per action present for
 * this hand, each segment's width proportional to its probability. */
function gradientFor(hand: Record<string, number>): string {
  const entries = orderedEntries(hand);
  let cursor = 0;
  const stops: string[] = [];
  for (const [action, prob] of entries) {
    const color = `var(${ACTION_COLOR_VAR[action]})`;
    const start = cursor;
    cursor += prob * 100;
    stops.push(`${color} ${start}%`, `${color} ${cursor}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export interface StrategyGridProps {
  /** hand label -> { action -> probability in [0, 1] }, exactly
   * LiveSolveResponse.strategy's shape. A hand absent here (not in
   * range, or never sampled enough for aggregate_label_strategies to
   * report it) renders as a flat, visibly-neutral cell rather than a
   * color -- the gap is real, not hidden. Read-only: this displays a
   * solve result, it doesn't edit a range. */
  strategy: Record<string, Record<string, number>>;
}

export function StrategyGrid({ strategy }: StrategyGridProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const actionsPresent = ACTION_ORDER.filter((a) =>
    Object.values(strategy).some((hand) => a in hand),
  );

  const selectedHand = selected ? strategy[selected] : undefined;

  return (
    <div className="strategy-grid">
      {actionsPresent.length > 0 && (
        <div className="strategy-grid__legend">
          {actionsPresent.map((action) => (
            <span className="strategy-grid__legend-item" key={action}>
              <span
                className="strategy-grid__swatch"
                style={{ background: `var(${ACTION_COLOR_VAR[action]})` }}
                aria-hidden="true"
              />
              {ACTION_LABEL[action]}
            </span>
          ))}
        </div>
      )}

      <div className="range-grid" role="grid" aria-label="Solved strategy" aria-readonly="true">
        {HAND_GRID.map((row, r) => (
          <div className="range-grid__row" role="row" key={r}>
            {row.map((hand) => {
              const data = strategy[hand];
              const style: CSSProperties = data
                ? { background: gradientFor(data) }
                : { background: "var(--range-empty)" };
              return (
                <button
                  key={hand}
                  type="button"
                  role="gridcell"
                  className="range-grid__cell"
                  data-has-data={!!data}
                  aria-pressed={selected === hand}
                  aria-label={
                    data
                      ? `${hand}: ${orderedEntries(data)
                          .map(([a, p]) => `${ACTION_LABEL[a]} ${Math.round(p * 100)}%`)
                          .join(", ")}`
                      : `${hand}: no data`
                  }
                  style={style}
                  onClick={() => setSelected(hand)}
                >
                  <span className="range-grid__label strategy-grid__label-chip">{hand}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="strategy-grid__detail">
        {selected && selectedHand
          ? `${selected}: ${orderedEntries(selectedHand)
              .map(([a, p]) => `${ACTION_LABEL[a]} ${Math.round(p * 100)}%`)
              .join(", ")}`
          : selected
            ? `${selected}: no data.`
            : "Tap a hand to see its exact breakdown."}
      </p>
    </div>
  );
}
