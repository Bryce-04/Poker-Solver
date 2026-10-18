import { useState } from "react";
import type { CSSProperties } from "react";
import { HAND_GRID } from "../../lib/hands";
import { ACTION_LABEL, ACTION_ORDER } from "../../lib/strategySummary";
import { comboSlots } from "../../lib/rangeCombos";
import "../RangeGrid/RangeGrid.css";
import "./StrategyGrid.css";

const ACTION_COLOR_VAR: Record<string, string> = {
  fold: "--strategy-fold",
  check: "--strategy-passive",
  call: "--strategy-passive",
  bet_small: "--strategy-bet-small",
  bet_medium: "--strategy-bet-mid",
  bet_large: "--strategy-bet-big",
  all_in: "--strategy-allin",
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
  /** Specific combo ("AhKh") -> the same action mix, for hand types whose
   * suits play differently (flush draws, blockers) -- LiveSolveResponse's
   * combo_strategy. A combo missing here plays like its hand type. */
  comboStrategy?: Record<string, Record<string, number>>;
  /** Board cards, greyed out in the suit view (those combos can't exist). */
  deadCards?: readonly string[];
}

const GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function describe(mix: Record<string, number>): string {
  return orderedEntries(mix)
    .map(([a, p]) => `${ACTION_LABEL[a]} ${Math.round(p * 100)}%`)
    .join(", ");
}

/** The selected hand's suit combos, each colored by its own action mix. */
function SuitStrategy({
  hand,
  handMix,
  comboStrategy,
  deadCards,
}: {
  hand: string;
  handMix: Record<string, number> | undefined;
  comboStrategy: Record<string, Record<string, number>>;
  deadCards: readonly string[];
}) {
  const dead = new Set(deadCards.map((c) => c[0].toUpperCase() + c[1].toLowerCase()));
  const differs = comboSlots(hand).some(({ combo }) => combo !== null && combo in comboStrategy);
  return (
    <div className="suit-strategy" role="group" aria-label={`${hand} by suit`}>
      <div className="suit-strategy__grid">
        {comboSlots(hand).map(({ combo, high, low }, i) => {
          if (combo === null) return <span key={i} className="suit-strategy__gap" aria-hidden="true" />;
          const blocked = dead.has(high) || dead.has(low);
          const mix = comboStrategy[combo] ?? handMix;
          return (
            <div
              key={combo}
              className="suit-strategy__combo"
              data-blocked={blocked || undefined}
              role="img"
              aria-label={
                blocked ? `${combo}, on the board` : mix ? `${combo}: ${describe(mix)}` : `${combo}: no data`
              }
              style={{ background: !blocked && mix ? gradientFor(mix) : "var(--range-empty)" }}
            >
              <span className="suit-strategy__cards">
                <span data-suit={high[1]}>{high[0]}{GLYPH[high[1]]}</span>
                <span data-suit={low[1]}>{low[0]}{GLYPH[low[1]]}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="strategy-grid__detail">
        {differs
          ? "These suits play differently, usually because of flush draws or blockers."
          : "Every suit of this hand plays the same."}
      </p>
    </div>
  );
}

export function StrategyGrid({ strategy, comboStrategy = {}, deadCards = [] }: StrategyGridProps) {
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

      {selected && (
        <SuitStrategy
          hand={selected}
          handMix={selectedHand}
          comboStrategy={comboStrategy}
          deadCards={deadCards}
        />
      )}
    </div>
  );
}
