import { RANKS } from "../../lib/hands";
import "./CardPicker.css";

/** s/h/c/d, top to bottom -- alternating black and red so same-color rows
 * never touch. Matches the schema's own suit-letter casing (lowercase). */
const SUITS = ["s", "h", "c", "d"] as const;

const SUIT_SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = {
  s: "spades",
  h: "hearts",
  d: "diamonds",
  c: "clubs",
};
const RANK_NAME: Record<string, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  T: "Ten",
};

function rankName(rank: string): string {
  return RANK_NAME[rank] ?? rank;
}

export interface CardPickerProps {
  /** Selected card codes, schema casing (e.g. "Ks", "9d"). Controlled --
   * this component owns no selection state itself, same convention as
   * RangeGrid. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Board picking stops at 5 (river) -- a sixth card is never legal. */
  max?: number;
}

/**
 * A 4 (suit) x 13 (rank) click-to-toggle grid for picking a 3-5 card
 * board -- the visual alternative to lib/cards.ts's typed board field on
 * SolvePage (see docs/decisions.md's 2026-10-06 entries; this is an
 * additional mode, not a replacement).
 *
 * Deliberately simpler than RangeGrid: plain native button tab order, no
 * roving-tabindex arrow-key navigation. RangeGrid earns that complexity
 * because dragging paints many of its 169 cells at once; this is just
 * "toggle up to `max` of 52," where Tab/Shift+Tab plus Enter/Space is
 * already fully keyboard-operable.
 */
export function CardPicker({ value, onChange, max = 5 }: CardPickerProps) {
  const atMax = value.length >= max;

  function toggle(card: string) {
    if (value.includes(card)) {
      onChange(value.filter((c) => c !== card));
    } else if (!atMax) {
      onChange([...value, card]);
    }
  }

  return (
    <div
      className="card-picker"
      role="grid"
      aria-label={`Board cards (up to ${max})`}
    >
      {SUITS.map((suit) => (
        <div className="card-picker__row" role="row" key={suit}>
          {RANKS.map((rank) => {
            const card = `${rank}${suit}`;
            const selected = value.includes(card);
            return (
              <button
                key={card}
                type="button"
                role="gridcell"
                className="card-picker__cell"
                data-suit={suit}
                data-selected={selected}
                aria-pressed={selected}
                aria-label={`${rankName(rank)} of ${SUIT_NAME[suit]}`}
                disabled={!selected && atMax}
                onClick={() => toggle(card)}
              >
                <span className="card-picker__rank">{rank}</span>
                <span className="card-picker__suit" aria-hidden="true">
                  {SUIT_SYMBOL[suit]}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
