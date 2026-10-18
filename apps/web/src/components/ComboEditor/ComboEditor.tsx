import type { CSSProperties } from "react";
import type { HandRange } from "@poker-solver/schema";
import {
  SUITS,
  comboKey,
  comboWeights,
  indexRange,
  setComboWeight,
  setLabelWeight,
} from "../../lib/rangeCombos";
import "./ComboEditor.css";

export interface ComboEditorProps {
  /** The hand type being edited, e.g. "AKs". */
  hand: string;
  value: HandRange;
  onChange: (next: HandRange) => void;
  /** Weight a tap writes to a combo that is currently out. */
  brush?: number;
  /** Cards that can't be held (the board): their combos are shown but
   * can't be toggled -- the solver drops them anyway. */
  deadCards?: readonly string[];
}

const GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

function cardText(card: string): string {
  return `${card[0]}${GLYPH[card[1]]}`;
}

/**
 * Suit-level editor for one hand type: a 4x4 grid of the suit combinations
 * (rows are the higher card's suit, columns the lower card's), so a range
 * can hold "only the heart combo of AKs" -- what flush draws and blockers
 * need. Pairs use the upper triangle (6 combos), suited hands the diagonal
 * (4), offsuit hands everything off it (12). Controlled and layout-free:
 * where it sits (a bottom sheet on a phone, a side panel on desktop) is the
 * caller's decision.
 */
export function ComboEditor({ hand, value, onChange, brush = 1, deadCards = [] }: ComboEditorProps) {
  const weights = comboWeights(indexRange(value), hand);
  const isPair = hand.length === 2;
  const suited = hand[2] === "s";
  const dead = new Set(deadCards.map((c) => c[0].toUpperCase() + c[1].toLowerCase()));

  const liveCombos = Object.keys(weights).filter((combo) => !dead.has(combo.slice(0, 2)) && !dead.has(combo.slice(2)));

  return (
    <div className="combo-editor" role="group" aria-label={`${hand} suit combinations`}>
      <div className="combo-editor__head">
        <strong>{hand}</strong>
        <span className="combo-editor__count">
          {liveCombos.filter((c) => weights[c] > 0).length}/{liveCombos.length} combos
        </span>
        <button
          type="button"
          className="combo-editor__bulk"
          onClick={() => onChange(setLabelWeight(value, hand, brush))}
        >
          All
        </button>
        <button
          type="button"
          className="combo-editor__bulk"
          onClick={() => onChange(setLabelWeight(value, hand, 0))}
        >
          None
        </button>
      </div>

      <div className="combo-editor__grid">
        {SUITS.map((rowSuit, r) =>
          SUITS.map((colSuit, c) => {
            const high = hand[0] + rowSuit;
            const low = hand[1] + colSuit;
            const applicable = isPair ? c > r : suited ? r === c : r !== c;
            if (!applicable) return <span key={`${r}-${c}`} className="combo-editor__gap" aria-hidden="true" />;

            const key = comboKey(high, low);
            const weight = weights[key] ?? 0;
            const blocked = dead.has(high) || dead.has(low);
            const pct = Math.round(weight * 100);
            return (
              <button
                key={key}
                type="button"
                className="combo-editor__combo"
                data-selected={weight > 0}
                data-blocked={blocked || undefined}
                disabled={blocked}
                aria-pressed={weight > 0}
                aria-label={`${key}${blocked ? ", on the board" : weight > 0 && weight < 1 ? `, ${pct}%` : ""}`}
                style={{ "--w": weight } as CSSProperties}
                onClick={() => onChange(setComboWeight(value, hand, key, weight > 0 ? 0 : brush))}
              >
                <span data-suit={high[1]}>{cardText(high)}</span>
                <span data-suit={low[1]}>{cardText(low)}</span>
                {weight > 0 && weight < 1 && <span className="combo-editor__weight">{pct}</span>}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
