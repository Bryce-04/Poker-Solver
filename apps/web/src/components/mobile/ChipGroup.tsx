import type { CSSProperties } from "react";
import "./ChipGroup.css";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface ChipGroupProps<T extends string> {
  /** What the group chooses ("Player 1", "Starting stack"), for screen readers. */
  label: string;
  options: readonly ChipOption<T>[];
  /** The pressed chip, or null when none is. */
  value: T | null;
  onChange: (value: T) => void;
  /** Chips per row; defaults to one row with every option. */
  columns?: number;
}

/**
 * A grid of 44px chips, one pressed at a time (docs/mobile-redesign.md §3.5):
 * seats, stacks, brush weights, ranks. Buttons with aria-pressed, like
 * SegmentedControl, for when the choices are many or short enough to tile.
 */
export function ChipGroup<T extends string>({ label, options, value, onChange, columns }: ChipGroupProps<T>) {
  const style = { "--chip-columns": columns ?? options.length } as CSSProperties;
  return (
    <div className="m-chip-group" role="group" aria-label={label} style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="m-chip"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
