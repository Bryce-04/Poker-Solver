import { useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { HandRange } from "@poker-solver/schema";
import { HAND_GRID } from "../../lib/hands";
import "./RangeGrid.css";

export interface RangeGridProps {
  /** Current selection. A hand present with weight > 0 is "in range";
   * missing/0 is "out". Controlled component -- this file never owns the
   * range itself, only transient UI state (brush, keyboard focus). */
  value: HandRange;
  onChange: (next: HandRange) => void;
  /** Render read-only (Stage 2 reference-chart display) instead of an
   * editable selector. Defaults to editable. */
  readOnly?: boolean;
}

// Preset brush frequencies for weighted selection. Painting writes the
// active brush weight; 100% is the common case and the default.
const BRUSH_WEIGHTS = [1, 0.75, 0.5, 0.25] as const;

const LAST = 12; // 13x13 grid, indices 0..12

/** Combos per hand class: 6 for a pair, 4 suited, 12 offsuit. */
function comboCount(hand: string): number {
  if (hand.length === 2) return 6;
  return hand.endsWith("s") ? 4 : 12;
}

const TOTAL_COMBOS = 1326;

/**
 * The 13x13 starting-hand range grid -- Stage 2's headline deliverable
 * alongside the spot builder. See docs/plan.md.
 *
 * Editable mode supports:
 *   - Click / tap a cell to toggle it between 0 and the brush weight.
 *   - Drag across cells to paint. The gesture's direction is fixed on
 *     pointerdown: starting on an empty cell fills, starting on a filled
 *     cell erases.
 *   - A brush-weight selector (100/75/50/25%) for weighted ranges; cells
 *     are shaded by weight so partial frequencies read at a glance.
 *   - Keyboard: arrow keys move a roving focus, Space/Enter toggles, and
 *     Home/End jump to the row ends.
 *
 * Read-only mode drops all of that and just renders the shaded grid.
 */
export function RangeGrid({ value, onChange, readOnly = false }: RangeGridProps) {
  const [brush, setBrush] = useState<number>(1);
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  // Active drag direction, or null when not painting. Ref, not state --
  // it's read/written inside pointer handlers and never needs a re-render.
  const paintRef = useRef<null | "fill" | "erase">(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const weightOf = (hand: string) => value[hand] ?? 0;

  const summary = useMemo(() => {
    let combos = 0;
    for (const [hand, w] of Object.entries(value)) {
      if (w > 0) combos += w * comboCount(hand);
    }
    return {
      combos: Math.round(combos * 10) / 10,
      pct: Math.round((combos / TOTAL_COMBOS) * 1000) / 10,
    };
  }, [value]);

  function writeHand(hand: string, weight: number): void {
    const next = { ...value };
    if (weight <= 0) delete next[hand];
    else next[hand] = weight;
    onChange(next);
  }

  function toggleHand(hand: string): void {
    writeHand(hand, weightOf(hand) > 0 ? 0 : brush);
  }

  function paint(hand: string): void {
    if (paintRef.current == null) return;
    const target = paintRef.current === "fill" ? brush : 0;
    if (weightOf(hand) === target) return;
    writeHand(hand, target);
  }

  function onCellPointerDown(e: PointerEvent<HTMLButtonElement>, hand: string): void {
    // Left button only; e.button can be 0 or undefined for the primary press.
    if (readOnly || (e.button && e.button !== 0)) return;
    paintRef.current = weightOf(hand) > 0 ? "erase" : "fill";
    paint(hand);
  }

  function onGridPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (readOnly || paintRef.current == null) return;
    // Button released (possibly outside the grid) -- end the gesture.
    if (e.buttons === 0) {
      paintRef.current = null;
      return;
    }
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-hand]");
    if (el?.dataset.hand) paint(el.dataset.hand);
  }

  function endPaint(): void {
    paintRef.current = null;
  }

  function moveFocus(row: number, col: number): void {
    const r = Math.max(0, Math.min(LAST, row));
    const c = Math.max(0, Math.min(LAST, col));
    setFocus([r, c]);
    cellRefs.current.get(`${r}-${c}`)?.focus();
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (readOnly) return;
    const [r, c] = focus;
    switch (e.key) {
      case "ArrowUp":
        moveFocus(r - 1, c);
        break;
      case "ArrowDown":
        moveFocus(r + 1, c);
        break;
      case "ArrowLeft":
        moveFocus(r, c - 1);
        break;
      case "ArrowRight":
        moveFocus(r, c + 1);
        break;
      case "Home":
        moveFocus(r, 0);
        break;
      case "End":
        moveFocus(r, LAST);
        break;
      case " ":
      case "Enter":
        toggleHand(HAND_GRID[r][c]);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function cellCommon(hand: string, r: number, c: number, weight: number) {
    return {
      role: "gridcell" as const,
      className: "range-grid__cell",
      "data-hand": hand,
      "data-selected": weight > 0,
      "data-tier": weight >= 0.5 ? "high" : "low",
      "data-diagonal": r === c || undefined,
      "aria-label":
        weight > 0 && weight < 1
          ? `${hand}, ${Math.round(weight * 100)}%`
          : hand,
      style: { "--w": weight } as CSSProperties,
      children: (
        <>
          <span className="range-grid__label">{hand}</span>
          {weight > 0 && weight < 1 && (
            <span className="range-grid__weight">
              {Math.round(weight * 100)}
            </span>
          )}
        </>
      ),
    };
  }

  return (
    <div className="range-grid-wrap">
      {!readOnly && (
        <div className="range-grid__brushes" role="group" aria-label="Brush weight">
          {BRUSH_WEIGHTS.map((w) => (
            <button
              type="button"
              key={w}
              className="range-grid__brush"
              data-active={w === brush}
              aria-pressed={w === brush}
              onClick={() => setBrush(w)}
            >
              {Math.round(w * 100)}%
            </button>
          ))}
          <button
            type="button"
            className="range-grid__brush range-grid__brush--clear"
            onClick={() => onChange({})}
          >
            Clear
          </button>
        </div>
      )}

      <div
        className="range-grid"
        role="grid"
        aria-label="Starting hand range"
        aria-readonly={readOnly || undefined}
        onPointerMove={onGridPointerMove}
        onPointerUp={endPaint}
        onPointerLeave={endPaint}
        onPointerCancel={endPaint}
        onKeyDown={onGridKeyDown}
      >
        {HAND_GRID.map((row, r) => (
          <div className="range-grid__row" role="row" key={r}>
            {row.map((hand, c) => {
              const weight = weightOf(hand);
              const isFocus = focus[0] === r && focus[1] === c;
              const common = cellCommon(hand, r, c, weight);
              return readOnly ? (
                <div key={hand} {...common} />
              ) : (
                <button
                  key={hand}
                  type="button"
                  {...common}
                  ref={(node) => {
                    if (node) cellRefs.current.set(`${r}-${c}`, node);
                    else cellRefs.current.delete(`${r}-${c}`);
                  }}
                  tabIndex={isFocus ? 0 : -1}
                  aria-pressed={weight > 0}
                  onFocus={() => setFocus([r, c])}
                  onPointerDown={(e) => onCellPointerDown(e, hand)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <p className="range-grid__summary">
        {summary.combos} combos <span aria-hidden="true">·</span>{" "}
        {summary.pct}% of hands
      </p>
    </div>
  );
}
