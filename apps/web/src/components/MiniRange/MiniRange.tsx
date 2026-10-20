import type { CSSProperties } from "react";
import type { HandRange } from "@poker-solver/schema";
import { HAND_GRID } from "../../lib/hands";
import { indexRange, labelWeight } from "../../lib/rangeCombos";
import "./MiniRange.css";

/**
 * A 13x13 thumbnail of a range: no labels, just which hands are in and how
 * much (fill height = weight, like the desktop RangeGrid). Decorative -- the
 * caller says what it is in text.
 */
export function MiniRange({ range }: { range: HandRange }) {
  const index = indexRange(range);
  return (
    <span className="mini-range" aria-hidden="true">
      {HAND_GRID.flat().map((hand) => (
        <span
          key={hand}
          className="mini-range__cell"
          style={{ "--w": labelWeight(index, hand) } as CSSProperties}
        />
      ))}
    </span>
  );
}
