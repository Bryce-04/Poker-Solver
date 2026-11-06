import { useState } from "react";
import "./ChipGroup.css"; // .m-chip, for the rank buttons
import "./RankSuitPicker.css";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
const SUITS = [
  { key: "s", symbol: "♠", name: "Spades", red: false },
  { key: "h", symbol: "♥", name: "Hearts", red: true },
  { key: "d", symbol: "♦", name: "Diamonds", red: true },
  { key: "c", symbol: "♣", name: "Clubs", red: false },
] as const;

/**
 * One card picked the phone way (docs/mobile-redesign.md §4.2): the rank
 * first, then the suit. A rank is off once all four of its cards are taken; a
 * suit is off until a rank is picked, or when that exact card is taken.
 * Shared by Solve's board step and the Coach's Add cards sheet.
 */
export function RankSuitPicker({
  taken,
  initialRank = null,
  onPick,
  labels = true,
  clearAfterPick = false,
}: {
  /** Cards that can't be picked (already on the board, or already chosen). */
  taken: Set<string>;
  initialRank?: string | null;
  onPick: (card: string) => void;
  /** Show the "1 · Rank" / "2 · Suit" labels. */
  labels?: boolean;
  /** Start over at "pick a rank" after each card (picking several in a row). */
  clearAfterPick?: boolean;
}) {
  const [rank, setRank] = useState<string | null>(initialRank);
  return (
    <>
      {labels && <span className="m-label">1 · Rank</span>}
      <div className="m-ranks" role="group" aria-label="Rank">
        {RANKS.map((r) => (
          <button
            key={r}
            type="button"
            className="m-chip"
            aria-pressed={rank === r}
            disabled={SUITS.every((suit) => taken.has(r + suit.key))}
            onClick={() => setRank(r)}
          >
            {r}
          </button>
        ))}
      </div>
      {labels && <span className="m-label">2 · Suit</span>}
      <div className="m-suits" role="group" aria-label="Suit">
        {SUITS.map((suit) => (
          <button
            key={suit.key}
            type="button"
            className="m-suit"
            data-red={suit.red || undefined}
            disabled={rank === null || taken.has(rank + suit.key)}
            onClick={() => {
              if (!rank) return;
              onPick(rank + suit.key);
              if (clearAfterPick) setRank(null);
            }}
          >
            <span aria-hidden="true">{suit.symbol}</span>
            <span className="m-suit__name">{suit.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
