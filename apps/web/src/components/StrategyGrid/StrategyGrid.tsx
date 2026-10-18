import { useState } from "react";
import type { CSSProperties } from "react";
import { HAND_GRID } from "../../lib/hands";
import { ACTION_LABEL, ACTION_ORDER } from "../../lib/strategySummary";
import type { HandRange } from "@poker-solver/schema";
import { comboSlots, comboWeights, handMass, indexRange } from "../../lib/rangeCombos";
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
  /** The range the strategy was solved for. With it, hands are faded by how
   * much of the range they are (a hand at 1% of the top hand's weight looks
   * nearly absent, not like a core hand) and suit combos that aren't in the
   * range are shown as such rather than as if they were. */
  range?: HandRange;
}

/** Combos a hand type has: 6 for a pair, 4 suited, 12 offsuit. */
function comboCountOf(hand: string): number {
  if (hand.length === 2) return 6;
  return hand.endsWith("s") ? 4 : 12;
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
  comboWeight,
}: {
  hand: string;
  handMix: Record<string, number> | undefined;
  comboStrategy: Record<string, Record<string, number>>;
  deadCards: readonly string[];
  /** Weight of each of this hand's combos in the range, when known. */
  comboWeight?: Record<string, number>;
}) {
  const dead = new Set(deadCards.map((c) => c[0].toUpperCase() + c[1].toLowerCase()));
  const differs = comboSlots(hand).some(({ combo }) => combo !== null && combo in comboStrategy);
  return (
    <div className="suit-strategy" role="group" aria-label={`${hand} by suit`}>
      <div className="suit-strategy__grid">
        {comboSlots(hand).map(({ combo, high, low }, i) => {
          if (combo === null) return <span key={i} className="suit-strategy__gap" aria-hidden="true" />;
          const blocked = dead.has(high) || dead.has(low);
          const outOfRange = !blocked && comboWeight !== undefined && (comboWeight[combo] ?? 0) <= 0;
          const mix = comboStrategy[combo] ?? handMix;
          return (
            <div
              key={combo}
              className="suit-strategy__combo"
              data-blocked={blocked || undefined}
              data-out={outOfRange || undefined}
              role="img"
              aria-label={
                blocked
                  ? `${combo}, on the board`
                  : outOfRange
                    ? `${combo}, not in the range`
                    : mix
                      ? `${combo}: ${describe(mix)}`
                      : `${combo}: no data`
              }
              style={{
                background: !blocked && !outOfRange && mix ? gradientFor(mix) : "var(--range-empty)",
              }}
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

export function StrategyGrid({
  strategy,
  comboStrategy = {},
  deadCards = [],
  range,
}: StrategyGridProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // How much of the range each hand type is, relative to the heaviest one.
  const index = range ? indexRange(range) : null;
  const mass = index ? handMass(index) : null;
  const heaviest = mass
    ? Math.max(0, ...Object.entries(mass).map(([hand, m]) => m / comboCountOf(hand)))
    : 0;
  const relativeWeight = (hand: string): number | null => {
    if (!mass || heaviest <= 0) return null;
    return (mass[hand] ?? 0) / comboCountOf(hand) / heaviest;
  };

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
              // A hand barely in the range is faded so it reads as barely
              // there; the floor keeps it findable.
              const rel = relativeWeight(hand);
              const style: CSSProperties = data
                ? {
                    background: gradientFor(data),
                    ...(rel !== null ? { opacity: 0.3 + 0.7 * Math.min(1, rel) } : {}),
                  }
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
              .join(", ")}${
              relativeWeight(selected) !== null && (relativeWeight(selected) as number) < 0.995
                ? ` (${Math.max(1, Math.round((relativeWeight(selected) as number) * 100))}% as much of the range as its heaviest hand)`
                : ""
            }`
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
          comboWeight={index ? comboWeights(index, selected) : undefined}
        />
      )}
    </div>
  );
}
