import type { HandRange } from "@poker-solver/schema";
import { HAND_GRID } from "../../lib/hands";
import "./RangeGrid.css";

export interface RangeGridProps {
  /** Current selection. A hand present with weight > 0 is "in range";
   * missing/0 is "out". Controlled component — this file never owns state. */
  value: HandRange;
  onChange: (next: HandRange) => void;
  /** Optional: render read-only (Stage 2 reference-chart display, results
   * view) instead of an editable selector. Defaults to editable. */
  readOnly?: boolean;
}

/**
 * The 13x13 starting-hand range grid — Stage 2's other headline deliverable
 * alongside the spot builder form. See docs/plan.md.
 *
 * STARTER SCAFFOLD — click-to-toggle (weight 0 or 1) is wired up and
 * working; the following are intentionally left as TODOs for whoever picks
 * this up:
 *
 *   - Weighted/partial selection. HandRange maps hand -> weight in [0, 1],
 *     not just in/out — e.g. a right-click or a small popover slider to set
 *     a hand's frequency instead of only fully in or out.
 *   - Drag-to-select across multiple cells (mousedown + mouseenter).
 *   - Visual weight shading (partial-weight hands should look visibly
 *     different from full-weight ones — see the dataviz skill for how to
 *     pick a shading scale that reads correctly in both light and dark
 *     mode, since this app needs to support both).
 *   - Keyboard navigation / accessibility (arrow keys + space to toggle).
 */
export function RangeGrid({ value, onChange, readOnly = false }: RangeGridProps) {
  function toggle(hand: string) {
    if (readOnly) return;
    const isSelected = (value[hand] ?? 0) > 0;
    const next = { ...value };
    if (isSelected) {
      delete next[hand];
    } else {
      next[hand] = 1;
    }
    onChange(next);
  }

  return (
    <div className="range-grid" role="grid" aria-label="Starting hand range">
      {HAND_GRID.map((row, rowIndex) => (
        <div className="range-grid__row" role="row" key={rowIndex}>
          {row.map((hand) => {
            const weight = value[hand] ?? 0;
            return (
              <button
                type="button"
                role="gridcell"
                key={hand}
                className="range-grid__cell"
                data-selected={weight > 0}
                aria-pressed={weight > 0}
                aria-label={hand}
                onClick={() => toggle(hand)}
                disabled={readOnly}
              >
                {hand}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
